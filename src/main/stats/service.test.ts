import { describe, expect, it, vi } from 'vitest'
import { PostsService, SettingsStore } from '../db'
import { openDatabase } from '../db/database'
import { XError, type TimelinePost } from '../x/client'
import { PLAN_CANT_READ, StatsService, withPostingCosts } from './service'

const NOW = new Date('2026-09-30T12:00:00Z')

function tl(id: string, impressions: number, extra: Partial<TimelinePost> = {}): TimelinePost {
  return {
    id,
    text: `post ${id}`,
    createdAt: '2026-09-29T10:00:00.000Z',
    impressions,
    likes: 1,
    reposts: 2,
    replies: 3,
    quotes: 0,
    bookmarks: 1,
    ...extra
  }
}

function setup(timeline: () => Promise<TimelinePost[]> = async () => []) {
  const db = openDatabase(':memory:')
  const posts = new PostsService(db, () => NOW)
  posts.useAccounts({ active: () => 'A', canPost: () => true })
  const settings = new SettingsStore(db)
  const changed: (string | null)[] = []
  const read = vi.fn<(account: string, max: number) => Promise<TimelinePost[]>>(timeline)
  const stats = new StatsService({
    db,
    settings,
    activeAccount: () => 'A',
    readTimeline: read,
    onChanged: (id) => changed.push(id),
    now: () => NOW
  })
  /** An OpenCatt post that went out as X post `remoteId`. */
  const published = (remoteId: string, text: string) => {
    const post = posts.create({ text, scheduledAt: '2026-10-01T09:00:00Z', accountId: 'A' })
    posts.markPosting(post.id)
    posts.markPosted(post.id, { remoteId, remoteUrl: `https://x.com/i/web/status/${remoteId}` })
    return post.id
  }
  return { stats, posts, settings, read, changed, published }
}

describe('StatsService (OP-109)', () => {
  it('estimates a refresh as the last 100 posts at the owned-read price', () => {
    const { stats } = setup()
    expect(stats.estimate()).toEqual({
      posts: 100,
      dollars: 0.1,
      upTo: true,
      pricesAsOf: '2026-09-30'
    })
  })

  it('stores the latest stats per X post, matches OpenCatt posts, and records each read', async () => {
    let round = 0
    const { stats, read, published, changed } = setup(async () =>
      ++round === 1
        ? [tl('x1', 10, { createdAt: '2026-09-29T11:00:00.000Z' }), tl('x2', 5)]
        : [tl('x1', 40, { createdAt: '2026-09-29T11:00:00.000Z' })]
    )
    const ours = published('x1', 'hello')

    expect(await stats.sync()).toEqual({ posts: 2, spent: 0.002, syncedAt: NOW.toISOString() })
    expect(read).toHaveBeenCalledWith('A', 100)
    await stats.sync()

    const rows = stats.list()
    expect(rows.map((r) => [r.remoteId, r.postId, r.stats.impressions])).toEqual([
      ['x1', ours, 40],
      ['x2', null, 5]
    ])
    // x2 wasn't returned the second time, so it keeps its last numbers.
    expect(rows.find((r) => r.remoteId === 'x1')!.readsCost).toBe(0.002)
    expect(rows.find((r) => r.remoteId === 'x2')).toMatchObject({
      readsCost: 0.001,
      postingCost: null
    })
    expect(stats.totals()).toMatchObject({ posts: 2, stats: { impressions: 45 }, readsCost: 0.003 })
    expect(stats.lastSync()).toEqual({ at: NOW.toISOString(), spent: 0.001 })
    expect(changed).toEqual(['A', 'A'])
  })

  it('records posting costs at the price of the day, and edits never change past spend', async () => {
    const { stats, published } = setup(async () => [tl('x1', 1), tl('x2', 1)])
    const plain = published('x1', 'plain text')
    const link = published('x2', 'see https://opencatt.app')
    stats.recordPosted('A', plain, 'x1', 'plain text')
    stats.recordPosted('A', link, 'x2', 'see https://opencatt.app')
    await stats.sync()

    stats.setPrices({ ownedRead: 0.01, post: 1, postWithUrl: 2 })
    const rows = stats.list()
    expect(rows.find((r) => r.remoteId === 'x1')).toMatchObject({
      postingCost: 0.015,
      readsCost: 0.001
    })
    expect(rows.find((r) => r.remoteId === 'x2')).toMatchObject({ postingCost: 0.2 })
    expect(stats.estimate().dollars).toBe(1)
    expect(stats.prices()).toMatchObject({ edited: true, ownedRead: 0.01 })
    expect(stats.resetPrices()).toMatchObject({ edited: false, ownedRead: 0.001 })
    expect(() => stats.setPrices({ post: -1 })).toThrow('A price must be a number of dollars')
  })

  it('estimates posting costs once for posts sent before costs were kept', async () => {
    const { stats, published } = setup(async () => [tl('x1', 1)])
    published('x1', 'older post with https://example.com')
    expect(stats.estimateOlderPosts()).toBe(1)
    expect(stats.estimateOlderPosts()).toBe(0)
    await stats.sync()
    expect(stats.list()[0]).toMatchObject({ postingCost: 0.2, postingEstimated: true })
  })

  it("says plainly when the X plan can't read posts, and records nothing", async () => {
    const { stats } = setup(async () => {
      throw new XError('rejected', 'X said: Forbidden', 403)
    })
    await expect(stats.sync()).rejects.toThrow(PLAN_CANT_READ)
    expect(stats.lastSync()).toBeNull()
  })

  it('runs one refresh at a time, so a double press pays once', async () => {
    const { stats, read } = setup(async () => [tl('x1', 1)])
    await Promise.all([stats.sync(), stats.sync()])
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('keeps a snapshot per refresh, oldest first, for charts of growth', async () => {
    let round = 0
    const { stats } = setup(async () =>
      ++round === 1 ? [tl('x1', 10), tl('x2', 5)] : [tl('x1', 40), tl('x2', 7)]
    )
    await stats.sync()
    await stats.sync()
    const history = stats.history()
    expect(history.map((s) => s.totals.impressions)).toEqual([15, 47])
    expect(history[1]!.posts).toContainEqual({
      remoteId: 'x1',
      stats: { impressions: 40, likes: 1, reposts: 2, replies: 3, quotes: 0, bookmarks: 1 }
    })
  })

  it("never lets a failed cost write break publishing: the thread goes on (Orion's review)", async () => {
    const { posts } = setup()
    const post = posts.create({
      parts: [{ text: 'one' }, { text: 'two' }, { text: 'three' }],
      scheduledAt: '2026-10-01T09:00:00Z',
      accountId: 'A'
    })
    const sent: string[] = []
    const logged: string[] = []
    const publish = withPostingCosts(
      async (p, onPart) => {
        for (const part of p.parts) {
          sent.push(part.text)
          onPart(part.id, { remoteId: `x-${part.text}`, remoteUrl: '' })
        }
        return { remoteId: 'x-one', remoteUrl: '' }
      },
      {
        recordPosted: () => {
          throw new Error('database is locked')
        }
      },
      (message) => logged.push(message)
    )
    const onPart = vi.fn()
    await expect(publish(post, onPart)).resolves.toEqual({ remoteId: 'x-one', remoteUrl: '' })
    expect(sent).toEqual(['one', 'two', 'three'])
    expect(onPart).toHaveBeenCalledTimes(3)
    expect(logged).toEqual([
      "Couldn't record the cost of X post x-one",
      "Couldn't record the cost of X post x-two",
      "Couldn't record the cost of X post x-three"
    ])
  })

  it('asks to reconnect in words about reading when X signed the account out', async () => {
    const { stats } = setup(async () => {
      throw new XError('auth', 'X signed this account out. Reconnect it to keep posting.')
    })
    await expect(stats.sync()).rejects.toThrow(
      'X signed this account out. Reconnect it under Integrations to read its stats.'
    )
  })
})

describe('StatsService Dashboard switch (OP-112)', () => {
  it('shows OpenCatt posts until changed, and keeps the choice per account', () => {
    const db = openDatabase(':memory:')
    const settings = new SettingsStore(db)
    let active: string | null = 'A'
    const stats = new StatsService({
      db,
      settings,
      activeAccount: () => active,
      readTimeline: async () => []
    })
    expect(stats.filter()).toBe('opencatt')
    expect(stats.setFilter('all')).toBe('all')
    expect(stats.filter()).toBe('all')
    active = 'B'
    expect(stats.filter()).toBe('opencatt')
    active = 'A'
    expect(stats.filter()).toBe('all')
    expect(settings.get('stats.filter.A')).toBe('all')
    expect(() => stats.setFilter('mine')).toThrow('Unknown Dashboard filter.')
  })
})
