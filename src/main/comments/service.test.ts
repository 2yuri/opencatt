import { describe, expect, it, vi } from 'vitest'
import { PostsService, SettingsStore } from '../db'
import { openDatabase } from '../db/database'
import { AutopilotStore } from '../agent/autopilot'
import { commentTools } from '../agent/commentTools'
import { runTool } from '../agent/tools'
import { mcpTools } from '../mcp/server'
import { StatsService } from '../stats/service'
import { XError, type Mention } from '../x/client'
import { CommentsService } from './service'

const NOW = new Date('2026-09-30T12:00:00Z')

function mention(id: string, fields: Partial<Mention> = {}): Mention {
  return {
    id,
    text: `@acme reply ${id}`,
    createdAt: '2026-09-30T10:00:00.000Z',
    conversationId: '900',
    inReplyTo: '900',
    author: { id: 'u9', handle: 'fan', name: 'A Fan' },
    ...fields
  }
}

type Page = { mentions: Mention[]; users: number; more?: boolean }

function setup(
  answer: (since: string | null, until: string | null) => Promise<Page> = async () => ({
    mentions: [],
    users: 0
  }),
  platform = 'x',
  active = 'A'
) {
  const db = openDatabase(':memory:')
  const posts = new PostsService(db, () => NOW)
  posts.useAccounts({ active: () => 'A', canPost: () => true })
  const settings = new SettingsStore(db)
  const autopilot = new AutopilotStore(settings, () => true)
  posts.useAutopilot((accountId, by) => autopilot.allows(accountId, by))
  const stats = new StatsService({
    db,
    settings,
    activeAccount: () => active,
    readTimeline: async () => [],
    now: () => NOW
  })
  const read = vi.fn(async (_account: string, since: string | null, until: string | null) => {
    const page = await answer(since, until)
    return { ...page, more: page.more ?? false }
  })
  const changed: (string | null)[] = []
  const comments = new CommentsService({
    db,
    settings,
    posts,
    activeAccount: () => active,
    ownedReadPrice: () => ({ price: stats.prices().ownedRead, asOf: stats.prices().asOf }),
    readMentions: read,
    platformOf: () => platform,
    onChanged: (id) => changed.push(id),
    now: () => NOW
  })
  /** An OpenCatt post that went out as X post `remoteId`. */
  const published = (remoteId: string): string => {
    const post = posts.create({ text: 'ours', scheduledAt: '2026-09-29T09:00:00Z', accountId: 'A' })
    posts.markPosting(post.id)
    posts.markPosted(post.id, { remoteId, remoteUrl: `https://x.com/i/web/status/${remoteId}` })
    return post.id
  }
  return { comments, posts, stats, settings, autopilot, read, changed, published, db }
}

describe('CommentsService (OP-124)', () => {
  it('estimates 100 mentions plus their authors at the owned-read price', () => {
    const { comments } = setup()
    expect(comments.estimate()).toEqual({
      reads: 200,
      dollars: 0.2,
      upTo: true,
      pricesAsOf: '2026-09-30'
    })
  })

  it("keeps only replies in our posts' threads, charges every mention and author, and moves since_id", async () => {
    const t = setup(async () => ({
      mentions: [
        mention('5003'),
        mention('5002', { conversationId: '555', inReplyTo: '555' }),
        mention('5001', { author: { id: 'A', handle: 'acme', name: null } })
      ],
      users: 2
    }))
    const threadPost = t.published('900')
    const result = await t.comments.refresh()
    expect(result).toMatchObject({ read: 3, kept: 1, spent: 0.005 })
    const list = t.comments.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      remoteId: '5003',
      postId: threadPost,
      author: { handle: 'fan', name: 'A Fan' },
      url: 'https://x.com/fan/status/5003',
      readAt: null,
      answer: null
    })
    expect(t.comments.lastRefresh()).toEqual({ at: NOW.toISOString(), spent: 0.005 })
    // Comment reads never count as a Dashboard sync.
    expect(t.stats.lastSync()).toBeNull()
    expect(t.settings.get('comments.sinceId.A')).toBe('5003')

    await t.comments.refresh()
    expect(t.read).toHaveBeenLastCalledWith('A', '5003', null)
    expect(t.changed).toEqual(['A', 'A'])
  })

  it('never skips replies when more than a page arrived: it keeps since_id and reads the older page next', async () => {
    const pages: Page[] = [
      { mentions: [mention('5000')], users: 1 },
      { mentions: [mention('5010'), mention('5009')], users: 1, more: true },
      { mentions: [mention('5008'), mention('5007')], users: 1, more: true },
      { mentions: [mention('5006')], users: 1 }
    ]
    const t = setup(async () => pages.shift()!)
    t.published('900')
    await t.comments.refresh()
    expect(t.settings.get('comments.sinceId.A')).toBe('5000')

    const busy = await t.comments.refresh()
    expect(busy.more).toBe(true)
    expect(t.read).toHaveBeenLastCalledWith('A', '5000', null)
    // since_id stays put until the gap is read.
    expect(t.settings.get('comments.sinceId.A')).toBe('5000')

    await t.comments.refresh()
    expect(t.read).toHaveBeenLastCalledWith('A', '5000', '5009')
    const last = await t.comments.refresh()
    expect(t.read).toHaveBeenLastCalledWith('A', '5000', '5007')
    expect(last.more).toBe(false)
    expect(t.settings.get('comments.sinceId.A')).toBe('5010')
    expect(t.comments.list().map((c) => c.remoteId)).toHaveLength(6)
  })

  it('keeps a reply that mentions two of our accounts under each of them', async () => {
    const db = { mentions: [mention('5003')], users: 1 }
    const a = setup(async () => db)
    a.published('900')
    await a.comments.refresh()
    // The same row for account B, in the same database.
    a.db
      .prepare(
        `INSERT INTO comments (remote_id, account_id, conversation_id, in_reply_to, author_id,
           author_handle, author_name, text, created_at, fetched_at)
         VALUES ('5003', 'B', '900', '900', 'u9', 'fan', NULL, 'hi', ?, ?)`
      )
      .run(NOW.toISOString(), NOW.toISOString())
    expect(a.comments.list('A')).toHaveLength(1)
    expect(a.comments.list('B')).toHaveLength(1)
  })

  it("won't move a reply to another account", async () => {
    const t = setup(async () => ({ mentions: [mention('5003')], users: 1 }))
    t.published('900')
    await t.comments.refresh()
    const reply = t.comments.reply('5003', { text: 'Thanks!', scheduledAt: '2026-10-01T09:00:00Z' })
    expect(() => t.posts.update(reply.id, { accountId: 'B' })).toThrow(
      'A reply stays on the account whose comment it answers.'
    )
  })

  it('shares one refresh between two presses', async () => {
    const t = setup(async () => ({ mentions: [], users: 0 }))
    await Promise.all([t.comments.refresh(), t.comments.refresh()])
    expect(t.read).toHaveBeenCalledTimes(1)
  })

  it('explains what X refused in words about comments', async () => {
    const t = setup(async () => {
      throw new XError('rejected', 'Client Forbidden', 403)
    })
    await expect(t.comments.refresh()).rejects.toThrow("Your X plan can't read mentions.")
  })

  it('answers a comment with a scheduled post that replies to it, and marks it read and answered', async () => {
    const t = setup(async () => ({ mentions: [mention('5003')], users: 1 }))
    t.published('900')
    await t.comments.refresh()
    const reply = t.comments.reply('5003', { text: 'Thanks!' })
    expect(reply).toMatchObject({
      status: 'scheduled',
      replyTo: '5003',
      accountId: 'A',
      scheduledAt: NOW.toISOString()
    })
    expect(t.comments.list()[0]).toMatchObject({
      readAt: NOW.toISOString(),
      answer: { postId: reply.id, status: 'scheduled', scheduledAt: NOW.toISOString() }
    })
    expect(() => t.comments.reply('nope', { text: 'x' })).toThrow('That comment is gone.')
    expect(() => t.comments.reply('5003', { text: '  ' })).toThrow('Write a reply first.')
  })

  it('shows the thread post and, for a reply to a reply, the comment it answers, from local data', async () => {
    const t = setup(async () => ({
      mentions: [
        mention('5003'),
        mention('5004', {
          inReplyTo: '5003',
          createdAt: '2026-09-30T11:00:00.000Z',
          author: { id: 'u8', handle: 'other', name: null }
        })
      ],
      users: 2
    }))
    t.published('900')
    await t.comments.refresh()
    const [reply, first] = t.comments.list()
    expect(first).toMatchObject({
      thread: { remoteId: '900', text: 'ours', url: 'https://x.com/i/web/status/900' },
      threadParts: [{ remoteId: '900', text: 'ours' }],
      parent: null
    })
    expect(reply).toMatchObject({
      remoteId: '5004',
      parent: { remoteId: '5003', text: '@acme reply 5003', handle: 'fan' }
    })
    // Its conversation, from our post down: our part, then the comment it answers.
    expect(reply!.path).toEqual([
      { remoteId: '900', handle: '', text: 'ours' },
      { remoteId: '5003', handle: 'fan', text: '@acme reply 5003' }
    ])
    expect(reply!.pathComplete).toBe(true)
    expect(first!.path).toEqual([{ remoteId: '900', handle: '', text: 'ours' }])
  })

  it('marks comments read', async () => {
    const t = setup(async () => ({ mentions: [mention('5003')], users: 1 }))
    t.published('900')
    await t.comments.refresh()
    t.comments.markRead(['5003'])
    expect(t.comments.list()[0]!.readAt).toBe(NOW.toISOString())
  })

  it('refuses accounts on other platforms, for the estimate too', async () => {
    const t = setup(undefined, 'tiktok')
    await expect(t.comments.refresh()).rejects.toThrow(
      "Comments aren't available for TikTok accounts in OpenCatt yet, only for X."
    )
    expect(() => t.comments.estimate()).toThrow("Comments aren't available for TikTok")
  })

  it('tells the agent and MCP plainly that a TikTok account has no comments here', () => {
    const t = setup(undefined, 'tiktok')
    const tools = commentTools(t.comments, () => NOW, 'mcp', { forCall: () => 'A' })
    for (const [name, input] of [
      ['list_comments', {}],
      ['reply_to_comment', { comment_id: '1', text: 'hi' }]
    ] as const) {
      const out = runTool(tools, name, input)
      expect(out.isError).toBe(true)
      expect(JSON.parse(out.content).error).toBe(
        "Comments aren't available for TikTok accounts in OpenCatt yet, only for X."
      )
    }
  })
})

describe('comment tools (OP-124)', () => {
  async function ready() {
    const t = setup(async () => ({ mentions: [mention('5003')], users: 1 }))
    t.published('900')
    await t.comments.refresh()
    return t
  }

  it("lists stored comments without reading X, and the agent's reply waits for approval", async () => {
    const t = await ready()
    const tools = commentTools(t.comments, () => NOW, 'agent', { forCall: () => 'A' })
    const listed = JSON.parse(runTool(tools, 'list_comments', {}).content)
    expect(listed.comments[0]).toMatchObject({ id: '5003', from: '@fan', new: true })
    expect(t.read).toHaveBeenCalledTimes(1)

    const out = runTool(tools, 'reply_to_comment', { comment_id: '5003', text: 'Thanks!' })
    expect(out.isError).toBe(false)
    const reply = JSON.parse(out.content).reply
    expect(reply.status).toBe('pending_approval')
    expect(t.posts.get(reply.post_id)).toMatchObject({ replyTo: '5003', createdBy: 'agent' })
  })

  it('schedules the reply straight away when Autopilot is on, over MCP too', async () => {
    const t = await ready()
    t.autopilot.set('A', true)
    const tools = mcpTools(commentTools(t.comments, () => NOW, 'mcp', { forCall: () => 'A' }))
    expect(tools.map((x) => x.name)).toEqual(
      expect.arrayContaining(['list_comments', 'reply_to_comment'])
    )
    const out = runTool(tools, 'reply_to_comment', { comment_id: '5003', text: 'Thanks!' })
    expect(JSON.parse(out.content).reply.status).toBe('scheduled (Autopilot on)')
  })

  it('tells the model plainly what is wrong', async () => {
    const t = await ready()
    const tools = commentTools(t.comments, () => NOW, 'agent', { forCall: () => 'A' })
    const missing = runTool(tools, 'reply_to_comment', { comment_id: '1', text: 'hi' })
    expect(missing.isError).toBe(true)
    expect(JSON.parse(missing.content).error).toContain('No comment with id 1')
    const long = runTool(tools, 'reply_to_comment', { comment_id: '5003', text: 'x'.repeat(300) })
    expect(JSON.parse(long.content).error).toContain('280')
  })
})
