import { randomUUID } from 'node:crypto'
import type {
  AccountScope,
  DayCounts,
  LocalDate,
  NewPost,
  NewPostPart,
  PendingSummary,
  Post,
  PostErrorCode,
  PostAuthor,
  PostPart,
  PostPatch,
  PostStatus,
  PostsChangedEvent
} from '@shared/api'
import { MISSED_AFTER_MS } from '@shared/api'
import {
  PLATFORM_RULES,
  mediaProblem,
  textLength,
  type Platform,
  type PlatformRules
} from '@shared/platforms'
import { mediaFromRow, type MediaRow } from '../media/store'
import { transaction, type Database } from './database'
import { startOfLocalDay, startOfNextLocalDay, toLocalDate, toUtcIso } from './dates'

/** X's limits, for callers that are only about X. Every platform's are in src/shared/platforms.ts. */
export const MAX_PARTS = PLATFORM_RULES.x.maxParts
export const MAX_WEIGHTED_LENGTH = PLATFORM_RULES.x.maxText
// A post more than this late is missed: the publisher won't send it and approve() refuses it.
// Shared so the chat card can tell "time passed" the same way.
export { MISSED_AFTER_MS }
/** listRange's widest window: a six-week month grid fits with room to spare. */
export const MAX_RANGE_DAYS = 62
const POST_STATUSES: readonly PostStatus[] = [
  'pending_approval',
  'rejected',
  'scheduled',
  'posting',
  'posted',
  'failed'
]

/** Who is making a change. Only the user's own changes can make a post go out without approval. */
/** What PostsService needs to know about the X accounts; OP-5's XAuthService provides it. */
export interface PostAccounts {
  active(): string | null
  /** Connected and signed in, so a post can be moved to it. */
  canPost(accountId: string): boolean
  /** The account's platform (OP-118); unknown accounts, and posts without one, follow X's rules. */
  platform?(accountId: string): Platform | null
}

export interface ByWhom {
  by?: PostAuthor
}

interface PostRow {
  id: string
  account_id: string | null
  scheduled_at: string
  status: PostStatus
  posted_at: string | null
  remote_id: string | null
  remote_url: string | null
  error: string | null
  error_code: PostErrorCode | null
  created_at: string
  updated_at: string
  created_by: PostAuthor
  next_attempt_at: string | null
  autopilot: number
  reply_to: string | null
}

interface PartRow {
  id: string
  post_id: string
  position: number
  text: string
  remote_id: string | null
  remote_url: string | null
  posted_at: string | null
}

/** A request that breaks a posts rule, such as editing a post that is already on X. */
export class PostRuleError extends Error {
  override name = 'PostRuleError'
}

type Listener = (event: PostsChangedEvent) => void

/** Deletes media files once their rows are gone. In the app it is the MediaStore. */
export interface MediaFiles {
  removeFiles(files: string[]): void
}

interface Part {
  text: string
  media: { id: string; alt: string | null }[]
}

/**
 * The only writer of posts, their parts and attached media. The UI, the agent and the publisher
 * all go through it, so the status rules and X's limits hold everywhere and every change is
 * announced once.
 */
export class PostsService {
  private readonly listeners = new Set<Listener>()

  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
    private readonly files: MediaFiles = { removeFiles: () => {} }
  ) {}

  private accounts: PostAccounts = { active: () => null, canPost: () => false }

  /** Whether an account lets the agent or an MCP client schedule without approval (OP-103). */
  private autopilot: (accountId: string | null, by: PostAuthor) => boolean = () => false

  useAutopilot(check: (accountId: string | null, by: PostAuthor) => boolean): void {
    this.autopilot = check
  }

  /**
   * The X accounts (OP-5): posts created without an accountId go to the active one, and lists
   * and counts show the active one's unless asked for another (OP-63).
   */
  useAccounts(accounts: PostAccounts): void {
    this.accounts = accounts
  }

  /** The rules a post for this account has to follow. */
  private rulesOf(accountId: string | null): PlatformRules {
    const platform = accountId === null ? null : (this.accounts.platform?.(accountId) ?? null)
    return PLATFORM_RULES[platform ?? 'x']
  }

  /**
   * Which rows an AccountScope covers: the given account, or the active one when it is left out.
   * Posts with no account (made before any was connected) belong to every account.
   */
  private scope(accountId: AccountScope | undefined): { sql: string; params: string[] } {
    const id = accountId === undefined ? this.accounts.active() : accountId
    if (id === null) return { sql: '', params: [] }
    return { sql: ' AND (account_id = ? OR account_id IS NULL)', params: [id] }
  }

  onChanged(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(ids: string[]): void {
    for (const listener of this.listeners) listener({ ids })
  }

  get(id: string): Post | null {
    const row = this.db.prepare('SELECT * FROM posts WHERE id = ?').get(id) as PostRow | undefined
    return row ? this.hydrate([row])[0] : null
  }

  /** The post a media file is attached to, or null while it is unattached. */
  withMedia(mediaId: string): Post | null {
    const row = this.db
      .prepare(
        `SELECT p.post_id FROM post_media m JOIN post_parts p ON p.id = m.part_id WHERE m.id = ?`
      )
      .get(mediaId) as { post_id: string } | undefined
    return row ? this.get(row.post_id) : null
  }

  private require(id: string): Post {
    const post = this.get(id)
    if (!post) throw new PostRuleError(`No post with id ${id}`)
    return post
  }

  /**
   * A post from the agent or an MCP client (`by`) waits for the user's approval, unless its
   * account has Autopilot on for that author (OP-103).
   */
  create(input: NewPost, { by = 'user' }: ByWhom = {}): Post {
    const accountId = input.accountId ?? this.accounts.active()
    const rules = this.rulesOf(accountId)
    const parts = partsOf(input, rules)
    const at = this.now().toISOString()
    const id = randomUUID()
    const scheduledAt = toUtcIso(input.scheduledAt)
    const author = authorOf(by)
    const auto = author !== 'user' && this.autopilot(accountId, author)
    const status: PostStatus = author === 'user' || auto ? 'scheduled' : 'pending_approval'
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO posts
             (id, account_id, scheduled_at, status, created_by, created_at, updated_at, autopilot,
              reply_to)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          accountId,
          scheduledAt,
          status,
          author,
          at,
          at,
          auto ? 1 : 0,
          input.replyTo ?? null
        )
      this.writeParts(id, parts, [], rules)
    })
    this.changed([id])
    return this.require(id)
  }

  /** Posts whose scheduled time falls on this local day, earliest first. */
  listByDay(date: LocalDate, accountId?: AccountScope): Post[] {
    const scope = this.scope(accountId)
    const rows = this.db
      .prepare(
        `SELECT * FROM posts WHERE scheduled_at >= ? AND scheduled_at < ?${scope.sql}
         ORDER BY scheduled_at, created_at`
      )
      .all(
        startOfLocalDay(date).toISOString(),
        startOfNextLocalDay(date).toISOString(),
        ...scope.params
      )
    return this.hydrate(rows as unknown as PostRow[])
  }

  /**
   * Posts from local day `from` to `to`, both inclusive, grouped by local day with each day
   * earliest first. Days without posts are left out. At most MAX_RANGE_DAYS days.
   */
  listRange(from: LocalDate, to: LocalDate, accountId?: AccountScope): Record<LocalDate, Post[]> {
    const start = startOfLocalDay(from)
    const end = startOfNextLocalDay(to)
    if (end <= start) throw new PostRuleError('The range must end on or after the day it starts')
    const lastAllowed = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + MAX_RANGE_DAYS
    )
    if (end > lastAllowed) {
      throw new PostRuleError(`Ask for at most ${MAX_RANGE_DAYS} days at a time`)
    }
    const scope = this.scope(accountId)
    const rows = this.db
      .prepare(
        `SELECT * FROM posts WHERE scheduled_at >= ? AND scheduled_at < ?${scope.sql}
         ORDER BY scheduled_at, created_at`
      )
      .all(start.toISOString(), end.toISOString(), ...scope.params)
    const byDay: Record<LocalDate, Post[]> = {}
    for (const post of this.hydrate(rows as unknown as PostRow[])) {
      const day = toLocalDate(new Date(post.scheduledAt))
      ;(byDay[day] ??= []).push(post)
    }
    return byDay
  }

  /** Every post waiting for the user's approval, on any day, earliest first. */
  listPending(accountId?: AccountScope): Post[] {
    return this.listByStatus('pending_approval', accountId)
  }

  /** Every post with this status, on any day, earliest first. */
  listByStatus(status: PostStatus, accountId?: AccountScope): Post[] {
    if (!POST_STATUSES.includes(status)) throw new PostRuleError(`Unknown post status "${status}"`)
    const scope = this.scope(accountId)
    const rows = this.db
      .prepare(`SELECT * FROM posts WHERE status = ?${scope.sql} ORDER BY scheduled_at, created_at`)
      .all(status, ...scope.params)
    return this.hydrate(rows as unknown as PostRow[])
  }

  countsByDay(
    from: LocalDate,
    to: LocalDate,
    accountId?: AccountScope
  ): Record<LocalDate, DayCounts> {
    const scope = this.scope(accountId)
    const rows = this.db
      .prepare(
        `SELECT scheduled_at, status FROM posts WHERE scheduled_at >= ? AND scheduled_at < ?${scope.sql}`
      )
      .all(
        startOfLocalDay(from).toISOString(),
        startOfNextLocalDay(to).toISOString(),
        ...scope.params
      ) as unknown as Pick<PostRow, 'scheduled_at' | 'status'>[]
    const counts: Record<LocalDate, DayCounts> = {}
    for (const row of rows) {
      const day = toLocalDate(new Date(row.scheduled_at))
      counts[day] ??= {
        pending_approval: 0,
        rejected: 0,
        scheduled: 0,
        posting: 0,
        posted: 0,
        failed: 0
      }
      counts[day][row.status]++
    }
    return counts
  }

  /** How many posts wait for approval, for the badges, and the day of the earliest one. */
  pending(accountId?: AccountScope): PendingSummary {
    const scope = this.scope(accountId)
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count, MIN(scheduled_at) AS first FROM posts
         WHERE status = 'pending_approval'${scope.sql}`
      )
      .get(...scope.params) as { count: number; first: string | null }
    return { count: row.count, first: row.first ? toLocalDate(new Date(row.first)) : null }
  }

  /** How many posts wait for approval in each account, for the account switcher. */
  pendingByAccount(): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT account_id, COUNT(*) AS count FROM posts
         WHERE status = 'pending_approval' AND account_id IS NOT NULL GROUP BY account_id`
      )
      .all() as unknown as { account_id: string; count: number }[]
    return Object.fromEntries(rows.map((row) => [row.account_id, row.count]))
  }

  /**
   * Edits parts and/or time. Posting and posted posts are read-only, and so are the parts of a
   * failed thread that already went out. The user editing a failed post puts it back to scheduled,
   * which is how the UI retries it. A pending post stays pending, and a change by the agent or an
   * MCP client (`by`) sends any post back for approval, so an agent can't approve by editing.
   */
  update(id: string, patch: PostPatch, { by = 'user' }: ByWhom = {}): Post {
    const post = this.require(id)
    assertEditable(post)
    if (patch.parts !== undefined && patch.text !== undefined) {
      throw new PostRuleError('Give either text or parts, not both')
    }
    const scheduledAt =
      patch.scheduledAt === undefined ? post.scheduledAt : toUtcIso(patch.scheduledAt)
    const accountId = patch.accountId === undefined ? post.accountId : patch.accountId
    // A reply answers one comment on one account (OP-124): moved elsewhere it would mean nothing.
    if (post.replyTo !== null && accountId !== post.accountId) {
      throw new PostRuleError(
        'A reply stays on the account whose comment it answers. Write a new post to move it.'
      )
    }
    const rules = this.rulesOf(accountId)
    const kept = (): NewPostPart[] =>
      post.parts.map((part) => ({
        text: part.text,
        media: part.media.map((m) => ({ id: m.id, alt: m.alt }))
      }))
    let parts: Part[] | null = null
    if (patch.parts !== undefined) {
      parts = validParts(patch.parts, rules)
    } else if (patch.text !== undefined) {
      // Text alone is the single-post shorthand: the first part's text, everything else kept.
      parts = validParts(
        kept().map((part, i) => (i === 0 ? { ...part, text: patch.text! } : part)),
        rules
      )
    } else if (rules.platform !== this.rulesOf(post.accountId).platform) {
      // Moved to an account on another platform: the post as it is has to suit that one too.
      parts = validParts(kept(), rules)
    }
    if (parts) assertPostedPartsKept(post.parts, parts)
    if (accountId !== post.accountId && (accountId === null || !this.accounts.canPost(accountId))) {
      throw new PostRuleError('Pick one of your signed-in X accounts for this post')
    }
    // A thread that is partly on X has to finish from the account it started on: the rest go out as
    // replies to those posts, and another account's replies would break the thread.
    if (accountId !== post.accountId && post.parts.some((part) => part.remoteId !== null)) {
      throw new PostRuleError(
        'Part of this thread is already on X, so the rest has to go out from the same account'
      )
    }

    // The agent's or an MCP client's change waits for approval again, unless Autopilot is on for
    // the account (OP-103). A post that was already waiting keeps waiting: Autopilot never
    // approves anything retroactively.
    const author = authorOf(by)
    const auto =
      author !== 'user' && post.status !== 'pending_approval' && this.autopilot(accountId, author)
    const status: PostStatus =
      (author !== 'user' && !auto) || post.status === 'pending_approval'
        ? 'pending_approval'
        : 'scheduled'
    let removed: string[] = []
    transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE posts SET scheduled_at = ?, status = ?, account_id = ?, next_attempt_at = NULL, error = NULL,
           error_code = NULL, updated_at = ?,
           autopilot = CASE WHEN ? THEN 1 WHEN ? = 'pending_approval' THEN 0 ELSE autopilot END
           WHERE id = ?`
        )
        .run(scheduledAt, status, accountId, this.now().toISOString(), auto ? 1 : 0, status, id)
      if (parts) removed = this.writeParts(id, parts, post.parts, rules)
    })
    this.files.removeFiles(removed)
    this.changed([id])
    return this.require(id)
  }

  reschedule(id: string, scheduledAt: string, whom: ByWhom = {}): Post {
    return this.update(id, { scheduledAt }, whom)
  }

  /**
   * The user lets a pending post go out: it becomes scheduled, at `scheduledAt` when given. A time
   * less than an hour past is sent by the publisher right away; more than that is refused, because
   * the publisher would count it as missed.
   */
  approve(id: string, scheduledAt?: string): Post {
    const post = this.require(id)
    if (post.status !== 'pending_approval') {
      throw new PostRuleError(`Post ${id} is ${post.status}, not waiting for approval`)
    }
    const at = scheduledAt === undefined ? post.scheduledAt : toUtcIso(scheduledAt)
    if (new Date(at).getTime() < this.now().getTime() - MISSED_AFTER_MS) {
      throw new PostRuleError(
        'This post was due more than an hour ago. Pick a new time, then approve it.'
      )
    }
    const result = this.db
      .prepare(
        `UPDATE posts SET status = 'scheduled', scheduled_at = ?, next_attempt_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'pending_approval'`
      )
      .run(at, this.now().toISOString(), id)
    if (result.changes === 0) throw new PostRuleError(`Post ${id} is not waiting for approval`)
    this.changed([id])
    return this.require(id)
  }

  /**
   * The user turns down a pending post. It stays, with its parts and media, as rejected, so the
   * user and the agent can see what was turned down; only delete() changes it after that.
   */
  reject(id: string): Post {
    const result = this.db
      .prepare(
        `UPDATE posts SET status = 'rejected', next_attempt_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'pending_approval'`
      )
      .run(this.now().toISOString(), id)
    if (result.changes === 0) {
      const post = this.require(id)
      throw new PostRuleError(
        `Post ${id} is ${post.status}; only posts waiting for approval can be rejected`
      )
    }
    this.changed([id])
    return this.require(id)
  }

  /** Deletes the post, its parts and its media files. Parts already on X stay on X. */
  delete(id: string): void {
    const post = this.require(id)
    if (post.status !== 'rejected') assertEditable(post)
    const files = this.mediaOf(id).map((row) => row.file)
    // Parts and media rows go with it (ON DELETE CASCADE).
    this.db.prepare('DELETE FROM posts WHERE id = ?').run(id)
    this.files.removeFiles(files)
    this.changed([id])
  }

  /**
   * Gives every post without an account to `accountId`. Called when the user connects their X
   * account, so posts written before that (by hand or by the agent) post as them.
   */
  assignAccount(accountId: string): number {
    const rows = this.db
      .prepare('SELECT id FROM posts WHERE account_id IS NULL')
      .all() as unknown as { id: string }[]
    if (rows.length === 0) return 0
    this.db
      .prepare('UPDATE posts SET account_id = ?, updated_at = ? WHERE account_id IS NULL')
      .run(accountId, this.now().toISOString())
    this.changed(rows.map((row) => row.id))
    return rows.length
  }

  // Publisher transitions (OP-10). Main process only: never exposed over IPC.

  /** Scheduled posts due at or before `at`, earliest first. */
  listDue(at: Date = this.now()): Post[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM posts
         WHERE status = 'scheduled' AND COALESCE(next_attempt_at, scheduled_at) <= ?
         ORDER BY COALESCE(next_attempt_at, scheduled_at), created_at`
      )
      .all(at.toISOString())
    return this.hydrate(rows as unknown as PostRow[])
  }

  /** When the next scheduled post is due, across every account; null when none is scheduled. */
  nextDueAt(): Date | null {
    const row = this.db
      .prepare(
        `SELECT MIN(COALESCE(next_attempt_at, scheduled_at)) AS at FROM posts
         WHERE status = 'scheduled'`
      )
      .get() as { at: string | null }
    return row.at ? new Date(row.at) : null
  }

  /** Posts left in posting, across every account: the app stopped mid-publish. */
  listPosting(): Post[] {
    const rows = this.db
      .prepare(`SELECT * FROM posts WHERE status = 'posting' ORDER BY scheduled_at, created_at`)
      .all()
    return this.hydrate(rows as unknown as PostRow[])
  }

  /**
   * Claims a scheduled post for publishing. Returns false when it is no longer scheduled (edited,
   * deleted or already claimed), so the publisher never sends one post twice. A thread resumes
   * from its first part without a remoteId.
   */
  markPosting(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE posts SET status = 'posting', updated_at = ? WHERE id = ? AND status = 'scheduled'`
      )
      .run(this.now().toISOString(), id)
    if (result.changes === 0) return false
    this.changed([id])
    return true
  }

  /** Records one part of a posting thread as published, so a retry skips it. */
  markPartPosted(
    partId: string,
    remote: { remoteId: string; remoteUrl: string; postedAt?: Date }
  ): Post {
    const part = this.db.prepare('SELECT * FROM post_parts WHERE id = ?').get(partId) as
      PartRow | undefined
    if (!part) throw new PostRuleError(`No post part with id ${partId}`)
    const result = this.db
      .prepare(
        `UPDATE post_parts SET remote_id = ?, remote_url = ?, posted_at = ?
         WHERE id = ? AND post_id IN (SELECT id FROM posts WHERE status = 'posting')`
      )
      .run(remote.remoteId, remote.remoteUrl, toUtcIso(remote.postedAt ?? this.now()), partId)
    if (result.changes === 0) throw new PostRuleError(`Post ${part.post_id} is not posting`)
    this.changed([part.post_id])
    return this.require(part.post_id)
  }

  /**
   * Marks the whole post published once every part is on X. For a single post, `remote` may be
   * given instead of calling markPartPosted first. The post's remote id is the first part's.
   */
  markPosted(id: string, remote?: { remoteId: string; remoteUrl: string; postedAt?: Date }): Post {
    const post = this.require(id)
    if (post.status !== 'posting') throw new PostRuleError(`Post ${id} is not posting`)
    const postedAt = toUtcIso(remote?.postedAt ?? this.now())
    transaction(this.db, () => {
      if (remote && post.parts[0].remoteId === null) {
        this.db
          .prepare(
            'UPDATE post_parts SET remote_id = ?, remote_url = ?, posted_at = ? WHERE id = ?'
          )
          .run(remote.remoteId, remote.remoteUrl, postedAt, post.parts[0].id)
      }
      const unposted = this.db
        .prepare(
          'SELECT position FROM post_parts WHERE post_id = ? AND remote_id IS NULL ORDER BY position'
        )
        .all(id) as unknown as { position: number }[]
      if (unposted.length > 0) {
        throw new PostRuleError(`Part ${unposted[0].position + 1} of post ${id} is not on X yet`)
      }
      const head = this.db
        .prepare('SELECT remote_id, remote_url FROM post_parts WHERE post_id = ? AND position = 0')
        .get(id) as { remote_id: string; remote_url: string }
      this.db
        .prepare(
          `UPDATE posts SET status = 'posted', next_attempt_at = NULL, posted_at = ?, remote_id = ?, remote_url = ?,
           error = NULL, error_code = NULL, updated_at = ? WHERE id = ?`
        )
        .run(postedAt, head.remote_id, head.remote_url, this.now().toISOString(), id)
    })
    this.changed([id])
    return this.require(id)
  }

  /**
   * Fails a post that is posting, or a scheduled one the publisher gave up on before sending
   * (missed). Parts already on X keep their remote ids.
   */
  markFailed(id: string, errorCode: PostErrorCode, error: string): Post {
    const result = this.db
      .prepare(
        `UPDATE posts SET status = 'failed', next_attempt_at = NULL, error_code = ?, error = ?, updated_at = ?
         WHERE id = ? AND status IN ('scheduled', 'posting')`
      )
      .run(errorCode, error, this.now().toISOString(), id)
    if (result.changes === 0) {
      throw new PostRuleError(`Post ${id} is not scheduled or posting, so it cannot fail`)
    }
    this.changed([id])
    return this.require(id)
  }

  /**
   * Puts a post that was posting back to scheduled, for a retry at `retryAt`. Its scheduled_at,
   * the time the user picked, stays; the retry time is next_attempt_at (OP-69).
   */
  markRetry(id: string, retryAt: Date): Post {
    const result = this.db
      .prepare(
        `UPDATE posts SET status = 'scheduled', next_attempt_at = ?, updated_at = ?
         WHERE id = ? AND status = 'posting'`
      )
      .run(toUtcIso(retryAt), this.now().toISOString(), id)
    if (result.changes === 0) throw new PostRuleError(`Post ${id} is not posting`)
    this.changed([id])
    return this.require(id)
  }

  // Parts and media.

  /**
   * Replaces a post's parts inside the caller's transaction. Part ids and the remote ids of parts
   * already on X are kept by position. Returns the files of media no longer attached.
   */
  private writeParts(
    postId: string,
    parts: Part[],
    before: PostPart[],
    rules: PlatformRules
  ): string[] {
    const attached = this.mediaOf(postId)
    const attachedIds = new Set(attached.map((row) => row.id))
    const kinds = new Map<string, MediaRow['kind']>()
    const seen = new Set<string>()

    parts.forEach((part, i) => {
      for (const { id } of part.media) {
        if (seen.has(id)) throw new PostRuleError(`The same file is attached twice (part ${i + 1})`)
        seen.add(id)
        const row = this.db.prepare('SELECT * FROM post_media WHERE id = ?').get(id) as
          MediaRow | undefined
        if (!row || (row.part_id !== null && !attachedIds.has(id))) {
          throw new PostRuleError(`Part ${i + 1}: that file isn't available. Add it again.`)
        }
        kinds.set(id, row.kind)
      }
      assertMediaMix(
        i,
        part.media.map((m) => kinds.get(m.id)!),
        rules
      )
    })

    this.db
      .prepare(
        `UPDATE post_media SET part_id = NULL, position = NULL
         WHERE part_id IN (SELECT id FROM post_parts WHERE post_id = ?)`
      )
      .run(postId)
    this.db.prepare('DELETE FROM post_parts WHERE post_id = ?').run(postId)

    const insertPart = this.db.prepare(
      `INSERT INTO post_parts (id, post_id, position, text, remote_id, remote_url, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    const attach = this.db.prepare(
      'UPDATE post_media SET part_id = ?, position = ?, alt = ? WHERE id = ?'
    )
    parts.forEach((part, position) => {
      const old = before[position]
      const partId = old?.id ?? randomUUID()
      insertPart.run(
        partId,
        postId,
        position,
        part.text,
        old?.remoteId ?? null,
        old?.remoteUrl ?? null,
        old?.postedAt ?? null
      )
      part.media.forEach((m, i) => attach.run(partId, i, m.alt, m.id))
    })

    const dropped = attached.filter((row) => !seen.has(row.id))
    for (const row of dropped) this.db.prepare('DELETE FROM post_media WHERE id = ?').run(row.id)
    return dropped.map((row) => row.file)
  }

  private mediaOf(postId: string): MediaRow[] {
    return this.db
      .prepare(
        `SELECT m.* FROM post_media m JOIN post_parts p ON m.part_id = p.id WHERE p.post_id = ?`
      )
      .all(postId) as unknown as MediaRow[]
  }

  private hydrate(rows: PostRow[]): Post[] {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const parts = this.db
      .prepare(
        `SELECT * FROM post_parts WHERE post_id IN (${ids.map(() => '?').join(', ')})
         ORDER BY post_id, position`
      )
      .all(...ids) as unknown as PartRow[]
    const media = parts.length
      ? (this.db
          .prepare(
            `SELECT * FROM post_media WHERE part_id IN (${parts.map(() => '?').join(', ')})
             ORDER BY part_id, position`
          )
          .all(...parts.map((p) => p.id)) as unknown as MediaRow[])
      : []

    const mediaByPart = new Map<string, MediaRow[]>()
    for (const row of media) {
      const list = mediaByPart.get(row.part_id!) ?? []
      list.push(row)
      mediaByPart.set(row.part_id!, list)
    }
    const partsByPost = new Map<string, PostPart[]>()
    for (const row of parts) {
      const list = partsByPost.get(row.post_id) ?? []
      list.push({
        id: row.id,
        position: row.position,
        text: row.text,
        media: (mediaByPart.get(row.id) ?? []).map(mediaFromRow),
        remoteId: row.remote_id,
        remoteUrl: row.remote_url,
        postedAt: row.posted_at
      })
      partsByPost.set(row.post_id, list)
    }

    return rows.map((row) => {
      const postParts = partsByPost.get(row.id) ?? []
      return {
        id: row.id,
        accountId: row.account_id,
        nextAttemptAt: row.next_attempt_at,
        createdBy: row.created_by,
        autopilot: row.autopilot === 1,
        replyTo: row.reply_to,
        text: postParts[0]?.text ?? '',
        parts: postParts,
        scheduledAt: row.scheduled_at,
        status: row.status,
        postedAt: row.posted_at,
        remoteId: row.remote_id,
        remoteUrl: row.remote_url,
        error: row.error,
        errorCode: row.error_code,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    })
  }
}

function partsOf(input: NewPost, rules: PlatformRules): Part[] {
  if (input.parts !== undefined && input.text !== undefined) {
    throw new PostRuleError('Give either text or parts, not both')
  }
  return validParts(input.parts ?? [{ text: input.text as string }], rules)
}

function validParts(parts: NewPostPart[], rules: PlatformRules): Part[] {
  if (!Array.isArray(parts) || parts.length === 0) throw new PostRuleError('A post needs some text')
  if (parts.length > rules.maxParts) {
    throw new PostRuleError(
      rules.maxParts === 1
        ? `A ${rules.name} post can't be a thread`
        : `A thread can have at most ${rules.maxParts} posts`
    )
  }
  return parts.map((part, i) => {
    const text = typeof part?.text === 'string' ? part.text : ''
    const media = (part.media ?? []).map((m) => ({
      id: String(m.id),
      alt: typeof m.alt === 'string' && m.alt.trim() ? m.alt.trim() : null
    }))
    const where = parts.length > 1 ? `Post ${i + 1} of the thread` : 'The post'
    if (rules.videoRequired && media.length === 0) {
      throw new PostRuleError(`A ${rules.name} post needs a video`)
    }
    if (text.trim() === '' && media.length === 0) {
      throw new PostRuleError(
        parts.length > 1 ? `${where} needs text or media` : 'A post needs some text'
      )
    }
    const length = textLength(rules, text)
    if (length > rules.maxText) {
      throw new PostRuleError(
        `${where} is ${length} characters; ${rules.name} allows ${rules.maxText}`
      )
    }
    return { text, media }
  })
}

/** The media on one part suits the platform: on X up to 4 images, or one GIF, or one video. */
function assertMediaMix(index: number, kinds: MediaRow['kind'][], rules: PlatformRules): void {
  // No media at all is validParts' to judge, together with the text.
  if (kinds.length === 0) return
  const problem = mediaProblem(rules, kinds)
  if (problem) throw new PostRuleError(`Part ${index + 1}: ${problem}`)
}

/** Parts already on X (a thread that failed halfway) can't change, only what comes after them. */
function assertPostedPartsKept(before: PostPart[], after: Part[]): void {
  before.forEach((old, i) => {
    if (old.remoteId === null) return
    const next = after[i]
    const same =
      next !== undefined &&
      next.text === old.text &&
      next.media.map((m) => m.id).join() === old.media.map((m) => m.id).join()
    if (!same) {
      throw new PostRuleError(`Post ${i + 1} of the thread is already on X and can't be changed`)
    }
  })
}

/** Anything that isn't a known author counts as the agent, never as the user. */
function authorOf(by: unknown): PostAuthor {
  return by === 'user' || by === 'mcp' ? by : 'agent'
}

function assertEditable(post: Post): void {
  if (post.status === 'rejected') {
    throw new PostRuleError(
      `Post ${post.id} was rejected and can't be changed. Delete it, or write a new post.`
    )
  }
  if (post.status === 'posting' || post.status === 'posted') {
    throw new PostRuleError(`Post ${post.id} is ${post.status} and can no longer be changed`)
  }
}
