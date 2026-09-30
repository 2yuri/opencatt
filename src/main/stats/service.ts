import { randomUUID } from 'node:crypto'
import twitter from 'twitter-text'
import type {
  JsonValue,
  Post,
  PostStats,
  PostStatsRow,
  StatsEstimate,
  StatsFilter,
  StatsSnapshot,
  StatsSyncResult,
  StatsTotals,
  XPrices
} from '@shared/api'
import type { Database } from '../db/database'
import type { SettingsStore } from '../db'
import { transaction } from '../db/database'
import { XError, type PublishedPart, type TimelinePost } from '../x/client'

/** X's pay-per-use prices, checked on its pricing page on 30 Sep 2026 (Company memory). */
export const DEFAULT_PRICES = {
  ownedRead: 0.001,
  post: 0.015,
  postWithUrl: 0.2
} as const
export const PRICES_AS_OF = '2026-09-30'
export const PRICING_URL = 'https://docs.x.com/x-api/getting-started/pricing'

/** How many of the account's latest posts one refresh reads (the boss, OP-109). */
export const SYNC_POSTS = 100

export const PLAN_CANT_READ =
  "Your X plan can't read posts. Reading stats needs pay-per-use or a paid plan."

const PRICES_KEY = 'x.prices'
/** Per account: `stats.filter.<accountId>` (OP-112). */
const FILTER_KEY = 'stats.filter'
type PriceField = 'ownedRead' | 'post' | 'postWithUrl'
const FIELDS: PriceField[] = ['ownedRead', 'post', 'postWithUrl']

/** What StatsService needs from the rest of main. */
export interface StatsDeps {
  db: Database
  settings: SettingsStore
  /** The X account the dashboard shows. */
  activeAccount: () => string | null
  readTimeline: (accountId: string, max: number) => Promise<TimelinePost[]>
  onChanged?: (accountId: string | null) => void
  now?: () => Date
}

interface StatsRow {
  remote_id: string
  post_id: string | null
  text: string
  posted_at: string
  impressions: number
  likes: number
  reposts: number
  replies: number
  quotes: number
  bookmarks: number
  synced_at: string
}

const round = (dollars: number): number => Math.round(dollars * 1e6) / 1e6

type Publish = (
  post: Post,
  onPartPosted: (partId: string, remote: PublishedPart) => void
) => Promise<PublishedPart>

/**
 * The publisher's send, recording each X post's cost once X has it (OP-109). The part is already
 * live by then, so a failed write is logged and dropped rather than thrown: a throw would mark a
 * live post as failed and stop a thread halfway. estimateOlderPosts fills the gap on next start.
 */
export function withPostingCosts(
  publish: Publish,
  stats: Pick<StatsService, 'recordPosted'>,
  log: (message: string, err: unknown) => void = (message, err) => console.warn(message, err)
): Publish {
  return (post, onPartPosted) =>
    publish(post, (partId, remote) => {
      onPartPosted(partId, remote)
      try {
        const text = post.parts.find((part) => part.id === partId)?.text ?? ''
        stats.recordPosted(post.accountId, post.id, remote.remoteId, text)
      } catch (err) {
        log(`Couldn't record the cost of X post ${remote.remoteId}`, err)
      }
    })
}

/**
 * Post stats read back from X on demand, and what every call to X costs (OP-109). Nothing here
 * runs on its own: a sync happens only when the user asks. Each cost row keeps the price it was
 * charged at; current prices only make estimates, and fill in posts from before costs were kept.
 */
export class StatsService {
  private readonly now: () => Date
  private syncing: Promise<StatsSyncResult> | null = null

  constructor(private readonly deps: StatsDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  prices(): XPrices {
    const saved = this.deps.settings.get(PRICES_KEY) as Partial<Record<PriceField, unknown>> | null
    const value = (field: PriceField): number => {
      const v = saved?.[field]
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_PRICES[field]
    }
    const prices = {
      ownedRead: value('ownedRead'),
      post: value('post'),
      postWithUrl: value('postWithUrl')
    }
    return {
      ...prices,
      asOf: PRICES_AS_OF,
      edited: FIELDS.some((f) => prices[f] !== DEFAULT_PRICES[f]),
      sourceUrl: PRICING_URL
    }
  }

  setPrices(patch: Partial<Record<PriceField, number>>): XPrices {
    if (!patch || typeof patch !== 'object') throw new Error('Nothing to change.')
    const next = { ...this.prices() }
    for (const field of FIELDS) {
      const v = patch[field]
      if (v === undefined) continue
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        throw new Error('A price must be a number of dollars, zero or more.')
      }
      next[field] = v
    }
    const saved: Record<PriceField, number> = {
      ownedRead: next.ownedRead,
      post: next.post,
      postWithUrl: next.postWithUrl
    }
    this.deps.settings.set(PRICES_KEY, saved as unknown as JsonValue)
    this.deps.onChanged?.(this.deps.activeAccount())
    return this.prices()
  }

  resetPrices(): XPrices {
    this.deps.settings.set(PRICES_KEY, null)
    this.deps.onChanged?.(this.deps.activeAccount())
    return this.prices()
  }

  /** What a refresh would cost at today's prices: X returns up to SYNC_POSTS posts. */
  estimate(): StatsEstimate {
    const prices = this.prices()
    return {
      posts: SYNC_POSTS,
      dollars: round(SYNC_POSTS * prices.ownedRead),
      upTo: true,
      pricesAsOf: prices.asOf
    }
  }

  /** Reads the active account's last posts from X, stores their stats and records the cost. */
  sync(): Promise<StatsSyncResult> {
    // One refresh at a time: a second press waits for the first instead of paying twice.
    this.syncing ??= this.runSync().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  private async runSync(): Promise<StatsSyncResult> {
    const accountId = this.deps.activeAccount()
    if (!accountId) throw new Error('Connect an X account to read its stats.')
    let posts: TimelinePost[]
    try {
      posts = await this.deps.readTimeline(accountId, SYNC_POSTS)
    } catch (err) {
      throw new Error(readError(err), { cause: err })
    }

    const at = this.now().toISOString()
    const syncId = randomUUID()
    const price = this.prices().ownedRead
    const { db } = this.deps
    const ours = this.ourParts(posts.map((p) => p.id))
    transaction(db, () => {
      const upsert = db.prepare(
        `INSERT INTO post_stats (remote_id, account_id, post_id, text, posted_at, impressions,
           likes, reposts, replies, quotes, bookmarks, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (remote_id) DO UPDATE SET post_id = excluded.post_id, text = excluded.text,
           impressions = excluded.impressions, likes = excluded.likes,
           reposts = excluded.reposts, replies = excluded.replies, quotes = excluded.quotes,
           bookmarks = excluded.bookmarks, synced_at = excluded.synced_at`
      )
      const snapshot = db.prepare(
        `INSERT INTO post_stats_history (sync_id, remote_id, account_id, at, impressions, likes,
           reposts, replies, quotes, bookmarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const cost = db.prepare(
        `INSERT INTO x_costs (id, account_id, kind, remote_id, post_id, sync_id, unit_price,
           dollars, estimated, at)
         VALUES (?, ?, 'read', ?, ?, ?, ?, ?, 0, ?)`
      )
      for (const post of posts) {
        const postId = ours.get(post.id) ?? null
        upsert.run(
          post.id,
          accountId,
          postId,
          post.text,
          post.createdAt,
          post.impressions,
          post.likes,
          post.reposts,
          post.replies,
          post.quotes,
          post.bookmarks,
          at
        )
        snapshot.run(
          syncId,
          post.id,
          accountId,
          at,
          post.impressions,
          post.likes,
          post.reposts,
          post.replies,
          post.quotes,
          post.bookmarks
        )
        // X charges per post returned, so each one carries its own read.
        cost.run(randomUUID(), accountId, post.id, postId, syncId, price, price, at)
      }
    })
    this.deps.onChanged?.(accountId)
    return { posts: posts.length, spent: round(posts.length * price), syncedAt: at }
  }

  /** Records what publishing one X post cost, at today's price, when the publisher sends it. */
  recordPosted(accountId: string | null, postId: string, remoteId: string, text: string): void {
    const prices = this.prices()
    const withUrl = hasUrl(text)
    this.deps.db
      .prepare(
        `INSERT INTO x_costs (id, account_id, kind, remote_id, post_id, unit_price, dollars,
           estimated, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
      )
      .run(
        randomUUID(),
        accountId,
        withUrl ? 'post_link' : 'post',
        remoteId,
        postId,
        withUrl ? prices.postWithUrl : prices.post,
        withUrl ? prices.postWithUrl : prices.post,
        this.now().toISOString()
      )
    this.deps.onChanged?.(accountId)
  }

  /**
   * Once, at startup: posts OpenCatt sent before costs were kept get an estimated posting cost
   * at today's prices, marked estimated, so the cost column isn't empty for them.
   */
  estimateOlderPosts(): number {
    const { db } = this.deps
    const parts = db
      .prepare(
        `SELECT p.id AS post_id, p.account_id, pp.remote_id, pp.text, pp.posted_at
         FROM post_parts pp JOIN posts p ON p.id = pp.post_id
         WHERE pp.remote_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM x_costs c
                           WHERE c.remote_id = pp.remote_id AND c.kind IN ('post', 'post_link'))`
      )
      .all() as unknown as {
      post_id: string
      account_id: string | null
      remote_id: string
      text: string
      posted_at: string | null
    }[]
    if (parts.length === 0) return 0
    const prices = this.prices()
    const insert = db.prepare(
      `INSERT INTO x_costs (id, account_id, kind, remote_id, post_id, unit_price, dollars,
         estimated, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`
    )
    transaction(db, () => {
      for (const part of parts) {
        const withUrl = hasUrl(part.text)
        const price = withUrl ? prices.postWithUrl : prices.post
        insert.run(
          randomUUID(),
          part.account_id,
          withUrl ? 'post_link' : 'post',
          part.remote_id,
          part.post_id,
          price,
          price,
          part.posted_at ?? this.now().toISOString()
        )
      }
    })
    return parts.length
  }

  /** The active account's posts, newest first, with their stats and costs. */
  list(): PostStatsRow[] {
    const accountId = this.deps.activeAccount()
    if (!accountId) return []
    const rows = this.deps.db
      .prepare('SELECT * FROM post_stats WHERE account_id = ? ORDER BY posted_at DESC')
      .all(accountId) as unknown as StatsRow[]
    const costs = this.costsByRemote(accountId)
    return rows.map((row) => {
      const c = costs.get(row.remote_id)
      return {
        remoteId: row.remote_id,
        postId: row.post_id,
        text: row.text,
        postedAt: row.posted_at,
        stats: statsOf(row),
        statsAt: row.synced_at,
        postingCost: row.post_id ? round(c?.posting ?? 0) : null,
        postingEstimated: c?.estimated ?? false,
        readsCost: round(c?.reads ?? 0)
      }
    })
  }

  totals(): StatsTotals {
    const rows = this.list()
    const stats: PostStats = {
      impressions: 0,
      likes: 0,
      reposts: 0,
      replies: 0,
      quotes: 0,
      bookmarks: 0
    }
    let postingCost = 0
    let readsCost = 0
    for (const row of rows) {
      for (const key of Object.keys(stats) as (keyof PostStats)[]) stats[key] += row.stats[key]
      postingCost += row.postingCost ?? 0
      readsCost += row.readsCost
    }
    return {
      posts: rows.length,
      stats,
      postingCost: round(postingCost),
      readsCost: round(readsCost)
    }
  }

  /** Which posts the Dashboard shows for the active account: only OpenCatt's until changed. */
  filter(): StatsFilter {
    const accountId = this.deps.activeAccount()
    const saved = accountId ? this.deps.settings.get(`${FILTER_KEY}.${accountId}`) : null
    return saved === 'all' ? 'all' : 'opencatt'
  }

  setFilter(filter: unknown): StatsFilter {
    if (filter !== 'all' && filter !== 'opencatt') throw new Error('Unknown Dashboard filter.')
    const accountId = this.deps.activeAccount()
    if (accountId) this.deps.settings.set(`${FILTER_KEY}.${accountId}`, filter)
    return filter
  }

  /** The active account's last refresh and what it cost. */
  lastSync(): { at: string; spent: number } | null {
    const accountId = this.deps.activeAccount()
    if (!accountId) return null
    const row = this.deps.db
      .prepare(
        `SELECT sync_id, MAX(at) AS at, SUM(dollars) AS spent FROM x_costs
         WHERE account_id = ? AND kind = 'read'
         GROUP BY sync_id ORDER BY MAX(rowid) DESC LIMIT 1`
      )
      .get(accountId) as { at: string; spent: number } | undefined
    return row ? { at: row.at, spent: round(row.spent) } : null
  }

  /**
   * Every refresh of the active account, oldest first: its totals over the posts it read, and each
   * post's numbers, for charts of growth over time. The totals only cover what that refresh read.
   */
  history(): StatsSnapshot[] {
    const accountId = this.deps.activeAccount()
    if (!accountId) return []
    const rows = this.deps.db
      .prepare(`SELECT * FROM post_stats_history WHERE account_id = ? ORDER BY at, rowid`)
      .all(accountId) as unknown as (Omit<
      StatsRow,
      'post_id' | 'text' | 'posted_at' | 'synced_at'
    > & {
      sync_id: string
      at: string
    })[]
    const bySync = new Map<string, StatsSnapshot>()
    for (const row of rows) {
      let snap = bySync.get(row.sync_id)
      if (!snap) {
        snap = { at: row.at, totals: emptyStats(), posts: [] }
        bySync.set(row.sync_id, snap)
      }
      const stats = statsOf(row)
      for (const key of Object.keys(stats) as (keyof PostStats)[]) snap.totals[key] += stats[key]
      snap.posts.push({ remoteId: row.remote_id, stats })
    }
    return [...bySync.values()]
  }

  /** OpenCatt's posts among these X ids: X post id → OpenCatt post id. */
  private ourParts(remoteIds: string[]): Map<string, string> {
    if (remoteIds.length === 0) return new Map()
    const rows = this.deps.db
      .prepare(
        `SELECT remote_id, post_id FROM post_parts
         WHERE remote_id IN (${remoteIds.map(() => '?').join(', ')})`
      )
      .all(...remoteIds) as unknown as { remote_id: string; post_id: string }[]
    return new Map(rows.map((r) => [r.remote_id, r.post_id]))
  }

  private costsByRemote(
    accountId: string
  ): Map<string, { posting: number; reads: number; estimated: boolean }> {
    const rows = this.deps.db
      .prepare(
        `SELECT remote_id, kind, SUM(dollars) AS dollars, MAX(estimated) AS estimated
         FROM x_costs WHERE account_id = ? AND remote_id IS NOT NULL
         GROUP BY remote_id, kind`
      )
      .all(accountId) as unknown as {
      remote_id: string
      kind: string
      dollars: number
      estimated: number
    }[]
    const out = new Map<string, { posting: number; reads: number; estimated: boolean }>()
    for (const row of rows) {
      const c = out.get(row.remote_id) ?? { posting: 0, reads: 0, estimated: false }
      if (row.kind === 'read') c.reads += row.dollars
      else {
        c.posting += row.dollars
        c.estimated ||= row.estimated === 1
      }
      out.set(row.remote_id, c)
    }
    return out
  }
}

const emptyStats = (): PostStats => ({
  impressions: 0,
  likes: 0,
  reposts: 0,
  replies: 0,
  quotes: 0,
  bookmarks: 0
})

function statsOf(row: PostStats): PostStats {
  return {
    impressions: row.impressions,
    likes: row.likes,
    reposts: row.reposts,
    replies: row.replies,
    quotes: row.quotes,
    bookmarks: row.bookmarks
  }
}

/** X prices a post with a link higher; a link is any URL X itself would recognise. */
function hasUrl(text: string): boolean {
  return twitter.extractUrls(text).length > 0
}

/** The sync's failure in words the dashboard shows as they are. */
function readError(err: unknown): string {
  if (err instanceof XError) {
    if (err.status === 403) return `${PLAN_CANT_READ} ${err.message}`
    if (err.status === 429)
      return `X is limiting reads right now. Try again in a few minutes. ${err.message}`
    // The auth error is worded for posting; this one is about reading.
    if (err.kind === 'auth') {
      return 'X signed this account out. Reconnect it under Integrations to read its stats.'
    }
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}
