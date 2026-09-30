import { randomUUID } from 'node:crypto'
import type {
  Comment,
  CommentReply,
  CommentsEstimate,
  CommentsRefreshResult,
  Post,
  PostAuthor,
  PostStatus
} from '@shared/api'
import type { Database } from '../db/database'
import type { PostsService, SettingsStore } from '../db'
import { transaction } from '../db/database'
import { XError, type Mention } from '../x/client'

/** One refresh reads at most this many mentions: X's page size. */
export const MENTIONS_PER_REFRESH = 100
const SINCE_KEY = 'comments.sinceId'
const PLATFORM_NAMES: Record<string, string> = { tiktok: 'TikTok', instagram: 'Instagram' }
/**
 * A gap still to read: X had more than one page of new mentions, and a refresh reads one page (so
 * its cost stays what the button says). The next refresh reads the page older than `until`, down
 * to since_id; `newest` becomes since_id once the gap is closed.
 */
const BACKLOG_KEY = 'comments.backlog'

export interface CommentsDeps {
  db: Database
  settings: SettingsStore
  posts: PostsService
  /** The account the Interactions page shows. */
  activeAccount: () => string | null
  /** X's price for one owned read, as the Dashboard's price table has it (OP-109). */
  ownedReadPrice: () => { price: number; asOf: string }
  readMentions: (
    accountId: string,
    sinceId: string | null,
    untilId: string | null
  ) => Promise<{ mentions: Mention[]; users: number; more: boolean }>
  /** The account's platform; comments are X only for now. */
  platformOf?: (accountId: string) => string | null
  onChanged?: (accountId: string | null) => void
  now?: () => Date
}

interface CommentRow {
  remote_id: string
  account_id: string
  conversation_id: string
  in_reply_to: string | null
  author_id: string
  author_handle: string
  author_name: string | null
  text: string
  created_at: string
  read_at: string | null
  answered_by: string | null
  thread_post: string | null
  thread_text: string | null
  thread_at: string | null
  parent_text: string | null
  parent_handle: string | null
  answer_status: PostStatus | null
  answer_at: string | null
}

const round = (dollars: number): number => Math.round(dollars * 1e6) / 1e6

/**
 * Replies to the account's posts on X (OP-124), read on demand only and answered through the
 * publisher. A reply is an ordinary post with replyTo, so it follows every rule posts do: its
 * cost goes in the ledger, and the agent's or an MCP client's replies wait for approval unless
 * the account has Autopilot on.
 */
export class CommentsService {
  private readonly now: () => Date
  private refreshing: Promise<CommentsRefreshResult> | null = null

  constructor(private readonly deps: CommentsDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  /**
   * What a refresh may cost: X returns up to 100 mentions, and may count each author it sends
   * along as another read, so the estimate counts both. The real charge is often lower.
   */
  estimate(): CommentsEstimate {
    // Only X has comments here for now: another platform gets the plain refusal, not a price.
    this.xAccount()
    const { price, asOf } = this.deps.ownedReadPrice()
    return {
      reads: MENTIONS_PER_REFRESH * 2,
      dollars: round(MENTIONS_PER_REFRESH * 2 * price),
      upTo: true,
      pricesAsOf: asOf
    }
  }

  /** Reads new mentions of the active account and keeps the replies in its threads. */
  refresh(): Promise<CommentsRefreshResult> {
    // One refresh at a time: a second press waits for the first instead of paying twice.
    this.refreshing ??= this.runRefresh().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  private async runRefresh(): Promise<CommentsRefreshResult> {
    const accountId = this.xAccount()
    const sinceKey = `${SINCE_KEY}.${accountId}`
    const backlogKey = `${BACKLOG_KEY}.${accountId}`
    const saved = this.deps.settings.get(sinceKey)
    const since = typeof saved === 'string' ? saved : null
    const backlog = backlogOf(this.deps.settings.get(backlogKey))
    let read: { mentions: Mention[]; users: number; more: boolean }
    try {
      read = await this.deps.readMentions(accountId, since, backlog?.until ?? null)
    } catch (err) {
      throw new Error(readError(err), { cause: err })
    }
    const at = this.now().toISOString()
    const refreshId = randomUUID()
    const { price } = this.deps.ownedReadPrice()
    const ours = this.ourThreads(accountId)
    // Replies in a thread one of our posts started, or straight to one of our posts; never our own.
    const kept = read.mentions.filter(
      (m) =>
        m.author.id !== accountId &&
        (ours.has(m.conversationId) || (m.inReplyTo !== null && ours.has(m.inReplyTo)))
    )
    const { db } = this.deps
    transaction(db, () => {
      const upsert = db.prepare(
        `INSERT INTO comments (remote_id, account_id, conversation_id, in_reply_to, author_id,
           author_handle, author_name, text, created_at, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (remote_id, account_id) DO UPDATE SET author_handle = excluded.author_handle,
           author_name = excluded.author_name, text = excluded.text,
           fetched_at = excluded.fetched_at`
      )
      for (const m of kept) {
        upsert.run(
          m.id,
          accountId,
          m.conversationId,
          m.inReplyTo,
          m.author.id,
          m.author.handle,
          m.author.name,
          m.text,
          m.createdAt,
          at
        )
      }
      // X charges for every mention it returns, kept or not, and maybe for each author.
      const cost = db.prepare(
        `INSERT INTO x_costs (id, account_id, kind, remote_id, sync_id, unit_price, dollars,
           estimated, at, source)
         VALUES (?, ?, 'read', ?, ?, ?, ?, 0, ?, 'comments')`
      )
      for (const m of read.mentions)
        cost.run(randomUUID(), accountId, m.id, refreshId, price, price, at)
      for (let i = 0; i < read.users; i++) {
        cost.run(randomUUID(), accountId, null, refreshId, price, price, at)
      }
    })
    const ids = read.mentions.map((m) => m.id)
    const newest = ids.reduce<string | null>((a, b) => (a === null || newerId(b, a) ? b : a), null)
    const oldest = ids.reduce<string | null>((a, b) => (a === null || newerId(a, b) ? b : a), null)
    // More than a page since the last refresh: keep since_id, and read the older page next time,
    // so no reply is ever skipped. A first refresh (no since_id) starts from the newest page only.
    const more = read.more && since !== null && oldest !== null
    if (backlog) {
      if (more) this.deps.settings.set(backlogKey, { ...backlog, until: oldest })
      else {
        this.deps.settings.set(sinceKey, backlog.newest)
        this.deps.settings.set(backlogKey, null)
      }
    } else if (more) {
      this.deps.settings.set(backlogKey, { until: oldest, newest: newest ?? since })
    } else if (newest && (since === null || newerId(newest, since))) {
      this.deps.settings.set(sinceKey, newest)
    }
    this.deps.onChanged?.(accountId)
    return {
      read: read.mentions.length,
      kept: kept.length,
      spent: round((read.mentions.length + read.users) * price),
      refreshedAt: at,
      more
    }
  }

  /** The account's comments, newest first: the active account's unless one is given. */
  list(accountId: string | null = this.deps.activeAccount()): Comment[] {
    if (!accountId) return []
    const rows = this.deps.db
      .prepare(
        // The thread's first post and the post a comment answers come from what OpenCatt already
        // has (its own parts, the Dashboard's reads, other comments), never an extra read on X.
        `SELECT c.*,
           (SELECT pp.post_id FROM post_parts pp WHERE pp.remote_id = c.conversation_id LIMIT 1)
             AS thread_post,
           COALESCE(
             (SELECT pp.text FROM post_parts pp WHERE pp.remote_id = c.conversation_id LIMIT 1),
             (SELECT s.text FROM post_stats s WHERE s.remote_id = c.conversation_id)
           ) AS thread_text,
           COALESCE(
             (SELECT pp.posted_at FROM post_parts pp WHERE pp.remote_id = c.conversation_id LIMIT 1),
             (SELECT s.posted_at FROM post_stats s WHERE s.remote_id = c.conversation_id)
           ) AS thread_at,
           CASE WHEN c.in_reply_to IS NULL OR c.in_reply_to = c.conversation_id THEN NULL ELSE
             COALESCE(
               (SELECT o.text FROM comments o WHERE o.remote_id = c.in_reply_to AND o.account_id = c.account_id),
               (SELECT pp.text FROM post_parts pp WHERE pp.remote_id = c.in_reply_to LIMIT 1),
               (SELECT s.text FROM post_stats s WHERE s.remote_id = c.in_reply_to)
             ) END AS parent_text,
           CASE WHEN c.in_reply_to IS NULL OR c.in_reply_to = c.conversation_id THEN NULL ELSE
             COALESCE(
               (SELECT o.author_handle FROM comments o WHERE o.remote_id = c.in_reply_to AND o.account_id = c.account_id),
               (SELECT a.handle FROM accounts a WHERE a.id = c.account_id)
             ) END AS parent_handle,
           p.status AS answer_status, p.scheduled_at AS answer_at
         FROM comments c LEFT JOIN posts p ON p.id = c.answered_by
         WHERE c.account_id = ? ORDER BY c.created_at DESC`
      )
      .all(accountId) as unknown as CommentRow[]
    // Every part of each OpenCatt thread, once per thread, so the page can mark the part replied to.
    const parts = new Map<string, { remoteId: string; text: string }[]>()
    const partsOf = this.deps.db.prepare(
      `SELECT remote_id, text FROM post_parts
       WHERE post_id = ? AND remote_id IS NOT NULL ORDER BY position`
    )
    // Comments by id, and our own parts by id, to walk a reply's conversation up to our post.
    const byId = new Map(rows.map((r) => [r.remote_id, r]))
    const handle =
      (
        this.deps.db.prepare('SELECT handle FROM accounts WHERE id = ?').get(accountId) as
          { handle: string } | undefined
      )?.handle ?? ''
    const ourPart = this.deps.db.prepare(
      `SELECT pp.text FROM post_parts pp WHERE pp.remote_id = ?
       UNION ALL SELECT s.text FROM post_stats s WHERE s.remote_id = ? LIMIT 1`
    )
    const pathOf = (row: CommentRow): { path: PathStep[]; complete: boolean } => {
      const path: PathStep[] = []
      const seen = new Set<string>([row.remote_id])
      let next = row.in_reply_to
      while (next && !seen.has(next)) {
        seen.add(next)
        const comment = byId.get(next)
        if (comment) {
          path.unshift({ remoteId: next, handle: comment.author_handle, text: comment.text })
          next = comment.in_reply_to
          continue
        }
        const ours = ourPart.get(next, next) as { text: string } | undefined
        if (!ours) return { path, complete: false }
        path.unshift({ remoteId: next, handle, text: ours.text })
        // One of our own parts: the rest of the way up is our thread, which threadParts shows.
        return { path, complete: true }
      }
      return { path, complete: next === null }
    }
    return rows.map((row) => {
      if (row.thread_post && !parts.has(row.thread_post)) {
        const list = partsOf.all(row.thread_post) as unknown as {
          remote_id: string
          text: string
        }[]
        parts.set(
          row.thread_post,
          list.map((p) => ({ remoteId: p.remote_id, text: p.text }))
        )
      }
      return commentOf(row, row.thread_post ? (parts.get(row.thread_post) ?? []) : [], pathOf(row))
    })
  }

  get(remoteId: string, accountId: string | null = this.deps.activeAccount()): Comment | null {
    return this.list(accountId).find((c) => c.remoteId === remoteId) ?? null
  }

  /** The active account's last refresh and what it cost. */
  lastRefresh(): { at: string; spent: number } | null {
    const accountId = this.deps.activeAccount()
    if (!accountId) return null
    const row = this.deps.db
      .prepare(
        `SELECT MAX(at) AS at, SUM(dollars) AS spent FROM x_costs
         WHERE account_id = ? AND source = 'comments'
         GROUP BY sync_id ORDER BY MAX(rowid) DESC LIMIT 1`
      )
      .get(accountId) as { at: string; spent: number } | undefined
    return row ? { at: row.at, spent: round(row.spent) } : null
  }

  markRead(remoteIds: string[]): void {
    const accountId = this.deps.activeAccount()
    if (!accountId || !Array.isArray(remoteIds) || remoteIds.length === 0) return
    const at = this.now().toISOString()
    const mark = this.deps.db.prepare(
      'UPDATE comments SET read_at = ? WHERE remote_id = ? AND account_id = ? AND read_at IS NULL'
    )
    transaction(this.deps.db, () => {
      for (const id of remoteIds) if (typeof id === 'string') mark.run(at, id, accountId)
    })
    this.deps.onChanged?.(accountId)
  }

  /**
   * Answers a comment with a post replying to it, at `scheduledAt` or now. From the user it is
   * scheduled; from the agent or an MCP client it waits for approval unless Autopilot is on.
   */
  reply(
    remoteId: string,
    reply: CommentReply,
    by: PostAuthor = 'user',
    account: string | null = this.deps.activeAccount()
  ): Post {
    const accountId = this.xAccount(account)
    const comment = this.get(String(remoteId), accountId)
    if (!comment || comment.accountId !== accountId) {
      throw new Error('That comment is gone. Refresh the page to see the current ones.')
    }
    const text = typeof reply?.text === 'string' ? reply.text.trim() : ''
    if (!text) throw new Error('Write a reply first.')
    const post = this.deps.posts.create(
      {
        accountId,
        text,
        scheduledAt: reply.scheduledAt ?? this.now().toISOString(),
        replyTo: comment.remoteId
      },
      { by }
    )
    this.deps.db
      .prepare(
        `UPDATE comments SET answered_by = ?, read_at = COALESCE(read_at, ?)
         WHERE remote_id = ? AND account_id = ?`
      )
      .run(post.id, this.now().toISOString(), comment.remoteId, accountId)
    this.deps.onChanged?.(accountId)
    return post
  }

  /** The active account, which must be on X. */
  /** The account, which must be on X; throws the plain reason otherwise. */
  xAccount(accountId: string | null = this.deps.activeAccount()): string {
    if (!accountId) throw new Error('Connect an X account to see its comments.')
    const platform = this.deps.platformOf?.(accountId) ?? 'x'
    if (platform !== 'x') {
      const name = PLATFORM_NAMES[platform] ?? 'this platform'
      throw new Error(`Comments aren't available for ${name} accounts in OpenCatt yet, only for X.`)
    }
    return accountId
  }

  /** The X ids of the account's own posts: every part OpenCatt sent, and every post the Dashboard read. */
  private ourThreads(accountId: string): Set<string> {
    const rows = this.deps.db
      .prepare(
        `SELECT pp.remote_id AS id FROM post_parts pp JOIN posts p ON p.id = pp.post_id
         WHERE p.account_id = ? AND pp.remote_id IS NOT NULL
         UNION SELECT remote_id AS id FROM post_stats WHERE account_id = ?`
      )
      .all(accountId, accountId) as unknown as { id: string }[]
    return new Set(rows.map((r) => r.id))
  }
}

function backlogOf(value: unknown): { until: string; newest: string } | null {
  const v = value as { until?: unknown; newest?: unknown } | null
  return v && typeof v.until === 'string' && typeof v.newest === 'string'
    ? { until: v.until, newest: v.newest }
    : null
}

/** X ids are numbers too long for a double; the longer one, or the larger at equal length, is newer. */
function newerId(a: string, b: string): boolean {
  return a.length !== b.length ? a.length > b.length : a > b
}

type PathStep = { remoteId: string; handle: string; text: string }

function commentOf(
  row: CommentRow,
  threadParts: { remoteId: string; text: string }[],
  conversation: { path: PathStep[]; complete: boolean }
): Comment {
  return {
    remoteId: row.remote_id,
    accountId: row.account_id,
    conversationId: row.conversation_id,
    inReplyTo: row.in_reply_to,
    postId: row.thread_post,
    thread:
      row.thread_text !== null
        ? {
            remoteId: row.conversation_id,
            text: row.thread_text,
            createdAt: row.thread_at,
            url: `https://x.com/i/web/status/${row.conversation_id}`
          }
        : null,
    threadParts,
    path: conversation.path,
    pathComplete: conversation.complete,
    parent:
      row.in_reply_to && row.parent_text !== null && row.parent_handle !== null
        ? { remoteId: row.in_reply_to, text: row.parent_text, handle: row.parent_handle }
        : null,
    author: { id: row.author_id, handle: row.author_handle, name: row.author_name },
    text: row.text,
    createdAt: row.created_at,
    url: `https://x.com/${row.author_handle}/status/${row.remote_id}`,
    readAt: row.read_at,
    answer:
      row.answered_by && row.answer_status && row.answer_at
        ? { postId: row.answered_by, status: row.answer_status, scheduledAt: row.answer_at }
        : null
  }
}

function readError(err: unknown): string {
  if (err instanceof XError) {
    if (err.status === 403) {
      return `Your X plan can't read mentions. Reading comments needs pay-per-use or a paid plan. ${err.message}`
    }
    if (err.status === 429) {
      return `X is limiting reads right now. Try again in a few minutes. ${err.message}`
    }
    if (err.kind === 'auth') {
      return 'X signed this account out. Reconnect it under Integrations to read its comments.'
    }
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}
