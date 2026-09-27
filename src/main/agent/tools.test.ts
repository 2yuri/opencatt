import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PostsToolResult, ToolResult } from '@shared/api'
import { PostsService } from '../db'
import { MediaStore } from '../media/store'
import { fakeMedia, tempDir } from '../media/testFiles'
import { openDatabase } from '../db/database'
import { localIso, namedAccounts, postTools, runTool, type ToolAccounts } from './tools'

// Tests run in Europe/Lisbon: WEST (+01:00) until 25 Oct 2026, then WET (+00:00).
const NOW = new Date('2026-09-26T20:00:00Z')

function setup(): {
  posts: PostsService
  run: (name: string, input: unknown) => ReturnType<typeof runTool>
} {
  const posts = new PostsService(openDatabase(':memory:'), () => NOW)
  const tools = postTools(posts, () => NOW)
  return { posts, run: (name, input) => runTool(tools, name, input) }
}

/** The posts a call touched; fails the test when it reported something else. */
function postsOf(outcome: { result?: ToolResult }): PostsToolResult {
  if (outcome.result?.kind !== 'posts') throw new Error('expected a posts result')
  return outcome.result
}

const body = (outcome: { content: string }): Record<string, unknown> =>
  JSON.parse(outcome.content) as Record<string, unknown>

describe('localIso', () => {
  it('writes the wall clock with the offset of that day, across DST', () => {
    expect(localIso(new Date('2026-09-28T08:00:00Z'))).toBe('2026-09-28T09:00:00+01:00')
    expect(localIso(new Date('2026-10-26T09:00:00Z'))).toBe('2026-10-26T09:00:00+00:00')
  })
})

describe('create_posts', () => {
  it('creates every post and reports them in local time', () => {
    const { posts, run } = setup()
    const out = run('create_posts', {
      posts: [
        { text: 'One', scheduled_at: '2026-09-28T09:00:00+01:00' },
        { text: '  Two  ', scheduled_at: '2026-10-26T09:00:00+00:00' }
      ]
    })

    expect(out.isError).toBe(false)
    expect(postsOf(out).action).toBe('created')
    expect(postsOf(out).postIds).toHaveLength(2)
    expect(posts.listByDay('2026-09-28').map((p) => p.text)).toEqual(['One'])
    expect(posts.listByDay('2026-10-26')[0]?.text).toBe('Two')
    expect(body(out)['created']).toMatchObject([
      { text: 'One', scheduled_at: '2026-09-28T09:00:00+01:00', weekday: 'Monday' },
      { text: 'Two', scheduled_at: '2026-10-26T09:00:00+00:00', weekday: 'Monday' }
    ])
  })

  it('creates none when one is invalid, and says which', () => {
    const { posts, run } = setup()
    const cases: [unknown, RegExp][] = [
      [{ text: 'x'.repeat(281), scheduled_at: '2026-09-28T09:00:00+01:00' }, /counts 281/],
      [{ text: 'Late', scheduled_at: '2026-09-26T20:00:00+01:00' }, /in the past/],
      [{ text: 'No offset', scheduled_at: '2026-09-28T09:00:00' }, /with an offset/],
      [{ text: '', scheduled_at: '2026-09-28T09:00:00+01:00' }, /non-empty/]
    ]
    for (const [bad, message] of cases) {
      const out = run('create_posts', {
        posts: [{ text: 'Fine', scheduled_at: '2026-09-28T10:00:00+01:00' }, bad]
      })
      expect(out.isError).toBe(true)
      expect(String(body(out)['error'])).toMatch(message)
      expect(String(body(out)['error'])).toContain('posts[1]')
    }
    expect(posts.listByDay('2026-09-28')).toEqual([])
  })

  it('counts characters the way X does: links 23, emoji 2', () => {
    const { run } = setup()
    const at = '2026-09-28T09:00:00+01:00'
    const link = `https://example.com/${'a'.repeat(200)}`
    expect(
      run('create_posts', { posts: [{ text: `${'x'.repeat(250)} ${link}`, scheduled_at: at }] })
        .isError
    ).toBe(false)
    expect(
      run('create_posts', { posts: [{ text: '🚀'.repeat(140), scheduled_at: at }] }).isError
    ).toBe(false)
    expect(
      run('create_posts', { posts: [{ text: '🚀'.repeat(141), scheduled_at: at }] }).isError
    ).toBe(true)
  })

  it('does not schedule the same text at the same time twice', () => {
    const { posts, run } = setup()
    const input = {
      posts: [
        { text: 'Once', scheduled_at: '2026-09-28T09:00:00+01:00' },
        { text: 'Twice', scheduled_at: '2026-09-28T12:00:00+01:00' }
      ]
    }
    run('create_posts', { posts: [input.posts[0]] })
    const again = run('create_posts', input)

    expect(posts.listByDay('2026-09-28').map((p) => p.text)).toEqual(['Once', 'Twice'])
    expect(postsOf(again).postIds).toHaveLength(1)
    expect(body(again)['already_scheduled']).toMatchObject([{ text: 'Once' }])
    expect(run('create_posts', input).result).toBeUndefined()
  })

  it('refuses more than ten at once', () => {
    const { run } = setup()
    const many = Array.from({ length: 11 }, () => ({
      text: 'x',
      scheduled_at: '2026-09-28T09:00:00+01:00'
    }))
    expect(run('create_posts', { posts: many }).isError).toBe(true)
  })
})

describe('list, update, reschedule, delete', () => {
  it('lists posts across a date range, earliest first', () => {
    const { posts, run } = setup()
    posts.create({ text: 'Tue', scheduledAt: '2026-09-29T09:00:00+01:00' })
    posts.create({ text: 'Mon', scheduledAt: '2026-09-28T09:00:00+01:00' })
    posts.create({ text: 'Later', scheduledAt: '2026-10-10T09:00:00+01:00' })

    const out = run('list_posts', { from: '2026-09-28', to: '2026-10-04' })
    expect((body(out)['posts'] as { text: string }[]).map((p) => p.text)).toEqual(['Mon', 'Tue'])
    expect(run('list_posts', { from: '2026-10-04', to: '2026-09-28' }).isError).toBe(true)
    expect(run('list_posts', { from: '2026-01-01', to: '2026-12-31' }).isError).toBe(true)
  })

  it('edits, moves and deletes a post, reporting each for the cards', () => {
    const { posts, run } = setup()
    const { id } = posts.create({ text: 'Draft', scheduledAt: '2026-09-28T09:00:00+01:00' })

    const updated = run('update_post', { id, text: 'Final' })
    expect(updated.result).toEqual({ kind: 'posts', action: 'updated', postIds: [id] })
    expect(posts.get(id)?.text).toBe('Final')

    const moved = run('reschedule_post', { id, scheduled_at: '2026-09-30T18:30:00+01:00' })
    expect(postsOf(moved).action).toBe('rescheduled')
    expect(posts.get(id)?.scheduledAt).toBe('2026-09-30T17:30:00.000Z')

    const deleted = run('delete_post', { id })
    expect(postsOf(deleted).action).toBe('deleted')
    expect(posts.get(id)).toBeNull()
  })

  it('returns PostsService rules and unknown ids as errors the model can read', () => {
    const { posts, run } = setup()
    const { id } = posts.create({ text: 'Out', scheduledAt: '2026-09-26T20:00:00Z' })
    posts.markPosting(id)
    posts.markPosted(id, { remoteId: '1', remoteUrl: 'https://x.com/i/1' })

    const out = run('update_post', { id, text: 'Edit' })
    expect(out.isError).toBe(true)
    expect(String(body(out)['error'])).toContain('posted')
    expect(String(body(run('delete_post', { id: 'nope' }))['error'])).toContain('list_posts')
    expect(run('no_such_tool', {}).isError).toBe(true)
  })
})

describe('list_posts and rejected posts', () => {
  it('shows the agent what the user turned down, marked rejected', () => {
    const { posts, run } = setup()
    const draft = posts.create(
      { text: 'Too salesy', scheduledAt: '2026-09-28T08:00:00Z' },
      { by: 'agent' }
    )
    posts.reject(draft.id)

    const listed = body(run('list_posts', { from: '2026-09-28', to: '2026-09-28' }))['posts']
    expect(listed).toEqual([
      expect.objectContaining({ id: draft.id, text: 'Too salesy', status: 'rejected' })
    ])
    expect(run('update_post', { id: draft.id, text: 'Less salesy' })).toMatchObject({
      isError: true,
      content: expect.stringContaining('was rejected')
    })
  })
})

describe('threads and media', () => {
  function withMedia(): {
    posts: PostsService
    image: (name?: string) => string
    run: (name: string, input: unknown) => ReturnType<typeof runTool>
    given: Set<string>
    attached: string[]
  } {
    const db = openDatabase(':memory:')
    const source = tempDir('opencat-src-')
    const media = new MediaStore(
      db,
      join(tempDir(), 'media'),
      () => null,
      () => NOW
    )
    const posts = new PostsService(db, () => NOW, media)
    const given = new Set<string>()
    const attached: string[] = []
    const tools = postTools(
      posts,
      () => NOW,
      'agent',
      () => given,
      {
        forCall: () => null,
        attached: () => attached
      }
    )
    return {
      posts,
      given,
      attached,
      image: (name = 'a.png') => media.import(fakeMedia(source, name)).id,
      run: (name, input) => runTool(tools, name, input)
    }
  }
  const at = '2026-09-29T09:00:00+01:00'

  it('schedules a thread as one post with its parts in order, waiting for approval', () => {
    const { posts, run } = withMedia()
    const out = run('create_posts', {
      posts: [{ parts: [1, 2, 3, 4, 5].map((n) => ({ text: `Part ${n}` })), scheduled_at: at }]
    })

    expect(out.isError).toBe(false)
    const [post] = posts.listByDay('2026-09-29')
    expect(post.status).toBe('pending_approval')
    expect(post.parts.map((p) => p.text)).toEqual([
      'Part 1',
      'Part 2',
      'Part 3',
      'Part 4',
      'Part 5'
    ])
    expect((body(out)['created'] as { parts: unknown[] }[])[0].parts).toHaveLength(5)
  })

  it('checks every part with X count before creating anything', () => {
    const { posts, run } = withMedia()
    const out = run('create_posts', {
      posts: [{ parts: [{ text: 'Fine' }, { text: 'x'.repeat(281) }], scheduled_at: at }]
    })

    expect(out.isError).toBe(true)
    expect(body(out)['error']).toMatch(/parts\[1\]\.text counts 281/)
    expect(posts.listByDay('2026-09-29')).toEqual([])
  })

  it("tells the model when the turn's attached file is on no post, until it is (OP-89)", () => {
    const { run, image, given, attached } = withMedia()
    const id = image()
    given.add(id)
    attached.push(id)

    const bare = run('create_posts', { posts: [{ text: 'A new logo', scheduled_at: at }] })
    expect(bare.isError).toBe(false)
    expect(body(bare)['attachment_note']).toContain(`The user attached ${id} to their message`)

    const postId = (body(bare)['created'] as { id: string }[])[0].id
    const fixed = run('update_post', {
      id: postId,
      parts: [{ text: 'A new logo', media: [{ id }] }]
    })
    expect(fixed.isError).toBe(false)
    expect(body(fixed)['attachment_note']).toBeUndefined()
  })

  it('adds no note when the turn has no attachments', () => {
    const { run } = withMedia()
    const out = run('create_posts', { posts: [{ text: 'Hello', scheduled_at: at }] })
    expect(body(out)['attachment_note']).toBeUndefined()
  })

  it('attaches media the user gave in the chat, with alt text', () => {
    const { posts, run, image, given } = withMedia()
    const id = image()
    given.add(id)
    const out = run('create_posts', {
      posts: [{ parts: [{ text: '', media: [{ id, alt: 'A cat' }] }], scheduled_at: at }]
    })

    expect(out.isError).toBe(false)
    const [post] = posts.listByDay('2026-09-29')
    expect(post.parts[0].media).toMatchObject([{ id, alt: 'A cat' }])
    expect((body(out)['created'] as { parts: unknown[] }[])[0].parts).toEqual([
      { text: '', media: [{ id, kind: 'image', alt: 'A cat' }] }
    ])
  })

  it('refuses media ids the user did not give in this chat', () => {
    const { posts, run, image } = withMedia()
    const out = run('create_posts', {
      posts: [{ parts: [{ text: 'Look', media: [{ id: image() }] }], scheduled_at: at }]
    })

    expect(out.isError).toBe(true)
    expect(body(out)['error']).toMatch(/isn't a file the user attached/)
    expect(posts.listByDay('2026-09-29')).toEqual([])
  })

  it('returns X media rules to the model as errors it can fix', () => {
    const { run, image, given } = withMedia()
    const ids = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png'].map((n) => image(n))
    ids.forEach((id) => given.add(id))
    const out = run('create_posts', {
      posts: [{ parts: [{ text: 'Five', media: ids.map((id) => ({ id })) }], scheduled_at: at }]
    })

    expect(out.isError).toBe(true)
    expect(body(out)['error']).toMatch(/up to 4 images/)
  })

  it('wants either text or parts', () => {
    const { run } = withMedia()
    for (const post of [
      { scheduled_at: at },
      { text: 'a', parts: [{ text: 'b' }], scheduled_at: at }
    ]) {
      const out = run('create_posts', { posts: [post] })
      expect(body(out)['error']).toMatch(/either text or parts/)
    }
  })

  it('does not create a thread twice on retry, and reports a rejected twin apart', () => {
    const { posts, run } = withMedia()
    const thread = { parts: [{ text: 'Head' }, { text: 'Tail' }], scheduled_at: at }
    run('create_posts', { posts: [thread] })

    const again = run('create_posts', { posts: [thread] })
    expect(body(again)['created']).toEqual([])
    expect(body(again)['already_scheduled']).toHaveLength(1)

    posts.reject(posts.listByDay('2026-09-29')[0].id)
    const refused = run('create_posts', { posts: [thread] })
    expect(body(refused)['already_scheduled']).toBeUndefined()
    expect(body(refused)['already_rejected']).toHaveLength(1)
    expect(body(refused)['note']).toMatch(/Write something different/)
    expect(posts.listByDay('2026-09-29')).toHaveLength(1)
  })

  it('update_post replaces the parts and may keep media already on the post', () => {
    const { posts, run, image, given } = withMedia()
    const id = image()
    given.add(id)
    run('create_posts', {
      posts: [{ parts: [{ text: 'One', media: [{ id }] }], scheduled_at: at }]
    })
    const post = posts.listByDay('2026-09-29')[0]
    given.clear()

    const out = run('update_post', {
      id: post.id,
      parts: [{ text: 'One, again', media: [{ id }] }, { text: 'Two' }]
    })

    expect(out.isError).toBe(false)
    expect(posts.get(post.id)?.parts.map((p) => [p.text, p.media.length])).toEqual([
      ['One, again', 1],
      ['Two', 0]
    ])
  })

  it('update_post with text alone keeps the media and the rest of the thread', () => {
    const { posts, run, image, given } = withMedia()
    const id = image()
    given.add(id)
    run('create_posts', {
      posts: [{ parts: [{ text: 'One', media: [{ id }] }, { text: 'Two' }], scheduled_at: at }]
    })
    const post = posts.listByDay('2026-09-29')[0]

    run('update_post', { id: post.id, text: 'Uno' })

    expect(posts.get(post.id)?.parts.map((p) => [p.text, p.media.length])).toEqual([
      ['Uno', 1],
      ['Two', 0]
    ])
  })
})

describe('each file on one post', () => {
  function withImage() {
    const db = openDatabase(':memory:')
    const media = new MediaStore(
      db,
      join(tempDir(), 'media'),
      () => null,
      () => NOW
    )
    const posts = new PostsService(db, () => NOW, media)
    const id = media.import(fakeMedia(tempDir('opencat-src-'), 'a.png')).id
    const tools = postTools(
      posts,
      () => NOW,
      'agent',
      () => new Set([id])
    )
    return { posts, id, run: (name: string, input: unknown) => runTool(tools, name, input) }
  }
  const at = (h: number): string => `2026-09-29T${String(h).padStart(2, '0')}:00:00+01:00`

  it('refuses the same file on two posts in one call and creates nothing', () => {
    const { posts, id, run } = withImage()
    const out = run('create_posts', {
      posts: [
        { parts: [{ text: 'One', media: [{ id }] }], scheduled_at: at(9) },
        { parts: [{ text: 'Two', media: [{ id }] }], scheduled_at: at(10) }
      ]
    })
    expect(out.isError).toBe(true)
    expect(body(out)['error']).toBe(
      `${id} is used twice in this call; each file can be on one post.`
    )
    expect(posts.listByDay('2026-09-29')).toEqual([])
  })

  it('refuses a file already on a post from an earlier turn, naming that post', () => {
    const { posts, id, run } = withImage()
    run('create_posts', {
      posts: [{ parts: [{ text: 'One', media: [{ id }] }], scheduled_at: at(9) }]
    })
    const first = posts.listByDay('2026-09-29')[0]

    const out = run('create_posts', {
      posts: [
        { text: 'Fine', scheduled_at: at(11) },
        { parts: [{ text: 'Two', media: [{ id }] }], scheduled_at: at(10) }
      ]
    })
    expect(body(out)['error']).toBe(
      `${id} is already on post ${first.id}; each file can be on one post.`
    )
    expect(posts.listByDay('2026-09-29')).toHaveLength(1)

    const other = run('create_posts', { posts: [{ text: 'Other', scheduled_at: at(12) }] })
    const otherId = (body(other)['created'] as { id: string }[])[0].id
    const moved = run('update_post', { id: otherId, parts: [{ text: 'Other', media: [{ id }] }] })
    expect(body(moved)['error']).toMatch(`already on post ${first.id}`)
  })

  it('still reports a retried post with its file as already scheduled', () => {
    const { posts, id, run } = withImage()
    const post = { parts: [{ text: 'One', media: [{ id }] }], scheduled_at: at(9) }
    run('create_posts', { posts: [post] })
    const again = run('create_posts', { posts: [post] })
    expect(again.isError).toBe(false)
    expect(body(again)['already_scheduled']).toHaveLength(1)
    expect(posts.listByDay('2026-09-29')).toHaveLength(1)
  })
})

describe('tools per X account', () => {
  const at = '2026-09-29T09:00:00+01:00'
  function twoAccounts(tools: (posts: PostsService, active: () => string) => ToolAccounts) {
    const posts = new PostsService(openDatabase(':memory:'), () => NOW)
    let active = 'A'
    posts.useAccounts({ active: () => active, canPost: () => true })
    const set = postTools(
      posts,
      () => NOW,
      'agent',
      undefined,
      tools(posts, () => active)
    )
    return {
      posts,
      switchTo: (id: string) => (active = id),
      run: (name: string, input: unknown) => runTool(set, name, input)
    }
  }

  it("the agent's tools act only in the turn's account", () => {
    let turn = 'A'
    const { posts, run } = twoAccounts(() => ({ forCall: () => turn }))
    run('create_posts', { posts: [{ text: 'For A', scheduled_at: at }] })
    turn = 'B'
    run('create_posts', { posts: [{ text: 'For B', scheduled_at: at }] })

    expect(posts.listByDay('2026-09-29', null).map((p) => [p.text, p.accountId])).toEqual([
      ['For A', 'A'],
      ['For B', 'B']
    ])
    const listed = run('list_posts', { from: '2026-09-29', to: '2026-09-29' })
    expect((body(listed)['posts'] as { text: string }[]).map((p) => p.text)).toEqual(['For B'])

    const aPost = posts.listByDay('2026-09-29', 'A')[0]
    const moved = run('reschedule_post', {
      id: aPost.id,
      scheduled_at: '2026-09-30T09:00:00+01:00'
    })
    expect(body(moved)['error']).toBe(`No post with id ${aPost.id}. Use list_posts to find it.`)
    expect(body(run('delete_post', { id: aPost.id }))['error']).toMatch(/No post with id/)
  })

  it('MCP clients may name an account by handle, and otherwise use the active one', () => {
    const accounts = [
      { id: 'A', handle: 'alpha', name: 'Alpha' },
      { id: 'B', handle: 'Beta', name: null }
    ]
    const { posts, run, switchTo } = twoAccounts((_posts, active) =>
      namedAccounts(() => accounts, active)
    )

    run('create_posts', { posts: [{ text: 'Active', scheduled_at: at }] })
    run('create_posts', { account: '@beta', posts: [{ text: 'Named', scheduled_at: at }] })
    expect(posts.listByDay('2026-09-29', null).map((p) => [p.text, p.accountId])).toEqual([
      ['Active', 'A'],
      ['Named', 'B']
    ])

    const unknown = run('list_posts', { account: 'gamma', from: '2026-09-29', to: '2026-09-29' })
    expect(body(unknown)['error']).toBe('No connected account @gamma. Connected: @alpha, @Beta.')

    switchTo('B')
    expect(body(run('list_accounts', {}))['accounts']).toEqual([
      { handle: '@alpha', name: 'Alpha', active: false },
      { handle: '@Beta', name: null, active: true }
    ])
  })
})
