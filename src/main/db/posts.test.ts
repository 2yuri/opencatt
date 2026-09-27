import { beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import type { NewPostPart, PostsChangedEvent } from '@shared/api'
import { MediaStore } from '../media/store'
import { fakeMedia, tempDir } from '../media/testFiles'
import { openDatabase } from './database'
import { PostRuleError, PostsService } from './posts'

// Tests run with TZ=Europe/Lisbon (see vitest.config.ts): UTC+1 in summer, UTC+0 after 25 Oct 2026.

let clock: Date
let posts: PostsService
let events: PostsChangedEvent[]

beforeEach(() => {
  clock = new Date('2026-09-26T10:00:00Z')
  posts = new PostsService(openDatabase(':memory:'), () => clock)
  events = []
  posts.onChanged((event) => events.push(event))
})

describe('create', () => {
  it('stores a scheduled post with its time in UTC', () => {
    const post = posts.create({ text: 'Hello X', scheduledAt: '2026-09-28T09:30:00+01:00' })
    expect(post).toMatchObject({
      text: 'Hello X',
      scheduledAt: '2026-09-28T08:30:00.000Z',
      status: 'scheduled',
      postedAt: null,
      error: null,
      errorCode: null,
      createdAt: '2026-09-26T10:00:00.000Z'
    })
    expect(posts.get(post.id)).toEqual(post)
    expect(events).toEqual([{ ids: [post.id] }])
  })

  it('refuses empty text and bad times', () => {
    expect(() => posts.create({ text: '   ', scheduledAt: '2026-09-28T09:00:00Z' })).toThrow(
      PostRuleError
    )
    expect(() => posts.create({ text: 'hi', scheduledAt: 'tomorrow-ish' })).toThrow(/not a valid/)
    expect(events).toEqual([])
  })
})

describe('listByDay and countsByDay', () => {
  it('groups by the local day, not the UTC day', () => {
    // 23:30 UTC on the 27th is 00:30 on the 28th in Lisbon summer time.
    const lateNight = posts.create({ text: 'a', scheduledAt: '2026-09-27T23:30:00Z' })
    const morning = posts.create({ text: 'b', scheduledAt: '2026-09-28T08:00:00Z' })
    posts.create({ text: 'c', scheduledAt: '2026-09-27T22:30:00Z' }) // 23:30 on the 27th

    expect(posts.listByDay('2026-09-28').map((p) => p.id)).toEqual([lateNight.id, morning.id])
    expect(posts.countsByDay('2026-09-27', '2026-09-28')).toEqual({
      '2026-09-27': {
        pending_approval: 0,
        rejected: 0,
        scheduled: 1,
        posting: 0,
        posted: 0,
        failed: 0
      },
      '2026-09-28': {
        pending_approval: 0,
        rejected: 0,
        scheduled: 2,
        posting: 0,
        posted: 0,
        failed: 0
      }
    })
  })

  it('handles the 25-hour day when summer time ends', () => {
    // 25 Oct 2026 in Lisbon runs from 23:00 UTC on the 24th to 00:00 UTC on the 26th.
    const first = posts.create({ text: 'first', scheduledAt: '2026-10-24T23:00:00Z' })
    const last = posts.create({ text: 'last', scheduledAt: '2026-10-25T23:59:00Z' })
    posts.create({ text: 'next day', scheduledAt: '2026-10-26T00:00:00Z' })

    expect(posts.listByDay('2026-10-25').map((p) => p.id)).toEqual([first.id, last.id])
    expect(posts.countsByDay('2026-10-25', '2026-10-25')).toEqual({
      '2026-10-25': {
        pending_approval: 0,
        rejected: 0,
        scheduled: 2,
        posting: 0,
        posted: 0,
        failed: 0
      }
    })
  })

  it('counts each status and leaves empty days out', () => {
    const a = posts.create({ text: 'a', scheduledAt: '2026-09-28T08:00:00Z' })
    const b = posts.create({ text: 'b', scheduledAt: '2026-09-28T09:00:00Z' })
    posts.create({ text: 'c', scheduledAt: '2026-09-28T10:00:00Z' })
    posts.markPosting(a.id)
    posts.markPosted(a.id, { remoteId: '1', remoteUrl: 'https://x.com/i/status/1' })
    posts.markFailed(b.id, 'missed', 'Missed by more than an hour')

    expect(posts.countsByDay('2026-09-01', '2026-09-30')).toEqual({
      '2026-09-28': {
        pending_approval: 0,
        rejected: 0,
        scheduled: 1,
        posting: 0,
        posted: 1,
        failed: 1
      }
    })
  })

  it('refuses dates that are not YYYY-MM-DD or not real', () => {
    expect(() => posts.listByDay('28/09/2026')).toThrow(/Expected a date/)
    expect(() => posts.listByDay('2026-02-30')).toThrow(/not a real date/)
  })
})

describe('update, reschedule and delete', () => {
  it('edits text and time of a scheduled post', () => {
    const post = posts.create({ text: 'draft', scheduledAt: '2026-09-28T08:00:00Z' })
    clock = new Date('2026-09-26T11:00:00Z')
    const updated = posts.update(post.id, { text: 'final' })
    expect(updated).toMatchObject({ text: 'final', scheduledAt: '2026-09-28T08:00:00.000Z' })
    expect(updated.updatedAt).toBe('2026-09-26T11:00:00.000Z')

    const moved = posts.reschedule(post.id, '2026-09-29T07:00:00Z')
    expect(moved.scheduledAt).toBe('2026-09-29T07:00:00.000Z')
    expect(events).toHaveLength(3)
  })

  it('puts a failed post back to scheduled and clears the error', () => {
    const post = posts.create({ text: 'a', scheduledAt: '2026-09-26T08:00:00Z' })
    posts.markFailed(post.id, 'missed', 'Missed by more than an hour')
    const retried = posts.reschedule(post.id, '2026-09-26T12:00:00Z')
    expect(retried).toMatchObject({ status: 'scheduled', error: null, errorCode: null })
  })

  it('refuses to change or delete a post that is posting or posted', () => {
    const post = posts.create({ text: 'a', scheduledAt: '2026-09-26T09:00:00Z' })
    posts.markPosting(post.id)
    expect(() => posts.update(post.id, { text: 'b' })).toThrow(/posting and can no longer/)
    expect(() => posts.delete(post.id)).toThrow(PostRuleError)

    posts.markPosted(post.id, { remoteId: '9', remoteUrl: 'https://x.com/i/status/9' })
    expect(() => posts.reschedule(post.id, '2026-09-27T09:00:00Z')).toThrow(/posted/)
    expect(() => posts.delete(post.id)).toThrow(PostRuleError)
  })

  it('deletes a scheduled post', () => {
    const post = posts.create({ text: 'a', scheduledAt: '2026-09-28T08:00:00Z' })
    posts.delete(post.id)
    expect(posts.get(post.id)).toBeNull()
    expect(() => posts.delete(post.id)).toThrow(/No post/)
  })
})

describe('publisher transitions', () => {
  it('lists only scheduled posts that are due', () => {
    const due = posts.create({ text: 'due', scheduledAt: '2026-09-26T09:59:00Z' })
    posts.create({ text: 'later', scheduledAt: '2026-09-26T10:01:00Z' })
    const failed = posts.create({ text: 'failed', scheduledAt: '2026-09-26T09:00:00Z' })
    posts.markFailed(failed.id, 'auth', 'Token expired')
    expect(posts.listDue().map((p) => p.id)).toEqual([due.id])
  })

  it('claims a post once, so it is never sent twice', () => {
    const post = posts.create({ text: 'a', scheduledAt: '2026-09-26T09:00:00Z' })
    expect(posts.markPosting(post.id)).toBe(true)
    expect(posts.markPosting(post.id)).toBe(false)
  })

  it('records the remote post when it is published', () => {
    const post = posts.create({ text: 'a', scheduledAt: '2026-09-26T09:00:00Z' })
    posts.markPosting(post.id)
    const posted = posts.markPosted(post.id, {
      remoteId: '123',
      remoteUrl: 'https://x.com/i/status/123'
    })
    expect(posted).toMatchObject({
      status: 'posted',
      remoteId: '123',
      remoteUrl: 'https://x.com/i/status/123',
      postedAt: '2026-09-26T10:00:00.000Z'
    })
  })

  it('forgets a waiting retry when the user edits or reschedules the post', () => {
    const post = posts.create({ text: 'a', scheduledAt: '2026-09-26T09:00:00Z' })
    posts.markPosting(post.id)
    posts.markRetry(post.id, new Date('2026-09-26T09:05:00Z'))
    expect(posts.update(post.id, { text: 'b' }).nextAttemptAt).toBeNull()
    posts.markPosting(post.id)
    posts.markRetry(post.id, new Date('2026-09-26T09:05:00Z'))
    expect(posts.reschedule(post.id, '2026-09-27T09:00:00Z').nextAttemptAt).toBeNull()
  })

  it('reschedules a retry and refuses transitions from the wrong state', () => {
    const post = posts.create({ text: 'a', scheduledAt: '2026-09-26T09:00:00Z' })
    expect(() => posts.markPosted(post.id, { remoteId: '1', remoteUrl: 'u' })).toThrow(
      /not posting/
    )
    posts.markPosting(post.id)
    const retry = posts.markRetry(post.id, new Date('2026-09-26T10:05:00Z'))
    expect(retry).toMatchObject({
      status: 'scheduled',
      scheduledAt: '2026-09-26T09:00:00.000Z',
      nextAttemptAt: '2026-09-26T10:05:00.000Z'
    })
    // Due by its retry time, not the time the user picked (OP-69).
    expect(posts.listDue(new Date('2026-09-26T10:00:00Z'))).toEqual([])
    expect(posts.listDue(new Date('2026-09-26T10:05:00Z')).map((p) => p.id)).toEqual([post.id])
    expect(posts.nextDueAt()).toEqual(new Date('2026-09-26T10:05:00Z'))

    posts.markPosting(post.id)
    expect(posts.markFailed(post.id, 'retries_exhausted', 'Too many requests').nextAttemptAt).toBe(
      null
    )
    expect(() => posts.markFailed(post.id, 'rejected', 'again')).toThrow(PostRuleError)
  })
})

it('stops telling a listener once it unsubscribes', () => {
  const seen: PostsChangedEvent[] = []
  const stop = posts.onChanged((event) => seen.push(event))
  posts.create({ text: 'a', scheduledAt: '2026-09-28T08:00:00Z' })
  stop()
  posts.create({ text: 'b', scheduledAt: '2026-09-28T09:00:00Z' })
  expect(seen).toHaveLength(1)
})

describe('accounts', () => {
  it('stores the account a post belongs to', () => {
    const post = posts.create({
      accountId: '44196397',
      text: 'a',
      scheduledAt: '2026-09-28T08:00:00Z'
    })
    expect(post.accountId).toBe('44196397')
    expect(posts.create({ text: 'b', scheduledAt: '2026-09-28T09:00:00Z' }).accountId).toBeNull()
  })

  it('assigns only the posts that have no account yet', () => {
    const mine = posts.create({ accountId: '1', text: 'a', scheduledAt: '2026-09-28T08:00:00Z' })
    const orphan = posts.create({ text: 'b', scheduledAt: '2026-09-28T09:00:00Z' })
    events = []

    expect(posts.assignAccount('2')).toBe(1)
    expect(posts.get(mine.id)?.accountId).toBe('1')
    expect(posts.get(orphan.id)?.accountId).toBe('2')
    expect(events).toEqual([{ ids: [orphan.id] }])
    expect(posts.assignAccount('2')).toBe(0)
  })
})

describe('threads and media', () => {
  let media: MediaStore
  let source: string
  let removed: string[]

  beforeEach(() => {
    const db = openDatabase(':memory:')
    source = tempDir('opencat-src-')
    removed = []
    media = new MediaStore(
      db,
      join(tempDir(), 'media'),
      () => null,
      () => clock
    )
    posts = new PostsService(db, () => clock, {
      removeFiles: (files) => {
        removed.push(...files)
        media.removeFiles(files)
      }
    })
  })

  const image = (name = 'a.png') => media.import(fakeMedia(source, name))
  const at = '2026-09-28T08:00:00Z'

  it('keeps a single text post as one part, with text mirrored on the post', () => {
    const post = posts.create({ text: 'Hello', scheduledAt: at })
    expect(post.text).toBe('Hello')
    expect(post.parts).toEqual([
      {
        id: expect.any(String),
        position: 0,
        text: 'Hello',
        media: [],
        remoteId: null,
        remoteUrl: null,
        postedAt: null
      }
    ])
  })

  it('finds the post a media file is attached to, and null while it is unattached', () => {
    const [a, loose] = [image('a.png'), image('b.png')]
    const post = posts.create({
      scheduledAt: at,
      parts: [{ text: 'x' }, { text: 'y', media: [{ id: a.id }] }]
    })
    expect(posts.withMedia(a.id)?.id).toBe(post.id)
    expect(posts.withMedia(loose.id)).toBeNull()
  })

  it('stores a thread with media and alt text, in order', () => {
    const [a, b] = [image('a.png'), image('b.png')]
    const video = media.import(fakeMedia(source, 'clip.mp4'))
    const post = posts.create({
      scheduledAt: at,
      parts: [
        { text: 'A thread 🧵', media: [{ id: a.id, alt: '  A cat  ' }, { id: b.id }] },
        { text: '', media: [{ id: video.id }] },
        { text: 'The end' }
      ]
    })

    expect(post.text).toBe('A thread 🧵')
    expect(post.parts.map((p) => [p.position, p.text, p.media.map((m) => m.kind)])).toEqual([
      [0, 'A thread 🧵', ['image', 'image']],
      [1, '', ['video']],
      [2, 'The end', []]
    ])
    expect(post.parts[0].media.map((m) => [m.id, m.alt])).toEqual([
      [a.id, 'A cat'],
      [b.id, null]
    ])
    expect(posts.listByDay('2026-09-28')[0]).toEqual(post)
  })

  it("refuses what X won't take", () => {
    const imgs = [1, 2, 3, 4, 5].map((n) => image(`${n}.png`))
    const gif = media.import(fakeMedia(source, 'a.gif'))
    const create = (parts: NewPostPart[]) => () => posts.create({ scheduledAt: at, parts })

    expect(create([{ text: 'five', media: imgs.map((m) => ({ id: m.id })) }])).toThrow(
      /up to 4 images/
    )
    expect(create([{ text: 'mix', media: [{ id: gif.id }, { id: imgs[1].id }] }])).toThrow(
      /only media in its post/
    )
    expect(create([{ text: 'a' }, { text: '  ' }])).toThrow(
      /Post 2 of the thread needs text or media/
    )
    expect(create(Array.from({ length: 26 }, () => ({ text: 'x' })))).toThrow(/at most 25/)
    expect(create([{ text: 'x'.repeat(281) }])).toThrow(/281 characters; X allows 280/)
    // X counts a link as 23 characters, however long it is.
    expect(
      create([{ text: `${'x'.repeat(250)} https://example.com/${'a'.repeat(100)}` }])
    ).not.toThrow()
    expect(create([{ text: 'a', media: [{ id: 'no-such-file' }] }])).toThrow(/isn't available/)
    expect(create([{ text: 'a', media: [{ id: imgs[2].id }, { id: imgs[2].id }] }])).toThrow(
      /attached twice/
    )
    expect(() => posts.create({ scheduledAt: at, text: 'a', parts: [{ text: 'b' }] })).toThrow(
      /either text or parts/
    )
  })

  it("won't attach a file that already belongs to another post", () => {
    const a = image()
    posts.create({ scheduledAt: at, parts: [{ text: 'mine', media: [{ id: a.id }] }] })
    expect(() =>
      posts.create({ scheduledAt: at, parts: [{ text: 'theirs', media: [{ id: a.id }] }] })
    ).toThrow(/isn't available/)
  })

  it('replaces parts on update, keeps part ids by position and deletes dropped media', () => {
    const [a, b] = [image('a.png'), image('b.png')]
    const post = posts.create({
      scheduledAt: at,
      parts: [{ text: 'one', media: [{ id: a.id }, { id: b.id }] }, { text: 'two' }]
    })

    const updated = posts.update(post.id, {
      parts: [{ text: 'one, edited', media: [{ id: b.id, alt: 'kept' }] }]
    })

    expect(updated.parts).toHaveLength(1)
    expect(updated.parts[0].id).toBe(post.parts[0].id)
    expect(updated.parts[0].media.map((m) => [m.id, m.alt])).toEqual([[b.id, 'kept']])
    expect(removed).toEqual([`${a.id}.png`])
    expect(() => media.pathOf(a.id)).toThrow()
  })

  it('text alone edits the first part and keeps its media and the rest of the thread', () => {
    const a = image()
    const post = posts.create({
      scheduledAt: at,
      parts: [{ text: 'one', media: [{ id: a.id }] }, { text: 'two' }]
    })
    const updated = posts.update(post.id, { text: 'uno' })
    expect(updated.parts.map((p) => [p.text, p.media.length])).toEqual([
      ['uno', 1],
      ['two', 0]
    ])
    expect(removed).toEqual([])
  })

  it('keeps a rejected post’s media until the post is deleted', () => {
    const a = image()
    const post = posts.create(
      { scheduledAt: at, parts: [{ text: 'x', media: [{ id: a.id }] }] },
      { by: 'agent' }
    )
    posts.reject(post.id)
    expect(removed).toEqual([])
    expect(posts.get(post.id)?.parts[0].media.map((m) => m.id)).toEqual([a.id])
    posts.delete(post.id)
    expect(removed).toEqual([`${a.id}.png`])
  })

  it('deletes media files with their post', () => {
    const a = image()
    const post = posts.create({ scheduledAt: at, parts: [{ text: 'x', media: [{ id: a.id }] }] })
    posts.delete(post.id)
    expect(removed).toEqual([`${a.id}.png`])
  })

  it('resumes a thread that failed halfway from its first unposted part', () => {
    const post = posts.create({
      scheduledAt: '2026-09-26T09:00:00Z',
      parts: [{ text: 'one' }, { text: 'two' }, { text: 'three' }]
    })
    posts.markPosting(post.id)
    posts.markPartPosted(post.parts[0].id, { remoteId: '1', remoteUrl: 'https://x.com/i/status/1' })
    expect(() => posts.markPosted(post.id)).toThrow(/Part 2 of post .* is not on X yet/)
    posts.markRetry(post.id, new Date('2026-09-26T10:05:00Z'))

    // The next attempt sees part 1 done and starts at part 2.
    expect(posts.markPosting(post.id)).toBe(true)
    const resumed = posts.get(post.id)!
    expect(resumed.parts.find((p) => p.remoteId === null)?.position).toBe(1)
    posts.markPartPosted(resumed.parts[1].id, {
      remoteId: '2',
      remoteUrl: 'https://x.com/i/status/2'
    })
    posts.markPartPosted(resumed.parts[2].id, {
      remoteId: '3',
      remoteUrl: 'https://x.com/i/status/3'
    })

    expect(posts.markPosted(post.id)).toMatchObject({
      status: 'posted',
      remoteId: '1',
      remoteUrl: 'https://x.com/i/status/1'
    })
  })

  it('keeps the parts already on X when a failed thread is edited', () => {
    const post = posts.create({
      scheduledAt: '2026-09-26T09:00:00Z',
      parts: [{ text: 'one' }, { text: 'two' }]
    })
    posts.markPosting(post.id)
    posts.markPartPosted(post.parts[0].id, { remoteId: '1', remoteUrl: 'u1' })
    posts.markFailed(post.id, 'retries_exhausted', 'X is down')

    expect(() => posts.update(post.id, { text: 'changed' })).toThrow(/already on X/)
    expect(() => posts.update(post.id, { parts: [{ text: 'two' }] })).toThrow(/already on X/)

    const fixed = posts.update(post.id, { parts: [{ text: 'one' }, { text: 'two, fixed' }] })
    expect(fixed.status).toBe('scheduled')
    expect(fixed.parts.map((p) => [p.text, p.remoteId])).toEqual([
      ['one', '1'],
      ['two, fixed', null]
    ])
  })

  it('refuses to mark a part posted unless its post is posting', () => {
    const post = posts.create({ scheduledAt: at, text: 'x' })
    expect(() => posts.markPartPosted(post.parts[0].id, { remoteId: '1', remoteUrl: 'u' })).toThrow(
      /not posting/
    )
    expect(() => posts.markPartPosted('nope', { remoteId: '1', remoteUrl: 'u' })).toThrow(
      /No post part/
    )
  })
})

describe('approval', () => {
  const tomorrow = '2026-09-27T09:00:00Z'

  it('holds posts from the agent or an MCP client until approved; the user posts straight away', () => {
    expect(posts.create({ text: 'mine', scheduledAt: tomorrow })).toMatchObject({
      status: 'scheduled',
      createdBy: 'user'
    })
    expect(posts.create({ text: 'agent', scheduledAt: tomorrow }, { by: 'agent' })).toMatchObject({
      status: 'pending_approval',
      createdBy: 'agent'
    })
    expect(posts.create({ text: 'outside', scheduledAt: tomorrow }, { by: 'mcp' })).toMatchObject({
      status: 'pending_approval',
      createdBy: 'mcp'
    })
    expect(posts.countsByDay('2026-09-27', '2026-09-27')['2026-09-27']).toMatchObject({
      pending_approval: 2,
      scheduled: 1
    })
  })

  it('counts what waits for approval and finds the earliest day, for the badges', () => {
    expect(posts.pending()).toEqual({ count: 0, first: null })
    posts.create({ text: 'mine', scheduledAt: '2026-09-27T08:00:00Z' })
    const late = posts.create({ text: 'b', scheduledAt: '2026-10-02T09:00:00Z' }, { by: 'agent' })
    posts.create({ text: 'a', scheduledAt: '2026-09-29T09:00:00Z' }, { by: 'mcp' })
    expect(posts.pending()).toEqual({ count: 2, first: '2026-09-29' })
    posts.approve(late.id)
    expect(posts.pending()).toEqual({ count: 1, first: '2026-09-29' })
  })

  it('never hands a pending post to the publisher', () => {
    const pending = posts.create(
      { text: 'agent', scheduledAt: '2026-09-26T09:30:00Z' },
      { by: 'agent' }
    )
    expect(posts.listDue().map((p) => p.id)).toEqual([])
    expect(posts.markPosting(pending.id)).toBe(false)
    expect(posts.get(pending.id)?.status).toBe('pending_approval')
  })

  it('approves at its own time or a new one', () => {
    const a = posts.create({ text: 'a', scheduledAt: tomorrow }, { by: 'agent' })
    expect(posts.approve(a.id)).toMatchObject({
      status: 'scheduled',
      scheduledAt: '2026-09-27T09:00:00.000Z'
    })

    const b = posts.create({ text: 'b', scheduledAt: tomorrow }, { by: 'mcp' })
    const moved = posts.approve(b.id, '2026-09-28T12:00:00+01:00')
    expect(moved).toMatchObject({ status: 'scheduled', scheduledAt: '2026-09-28T11:00:00.000Z' })
    expect(posts.listDue(new Date('2026-09-29T00:00:00Z')).map((p) => p.id)).toEqual([a.id, b.id])
  })

  it('lets a post just past its time go out now, and refuses one more than an hour late', () => {
    // The clock is 10:00Z.
    const recent = posts.create({ text: 'r', scheduledAt: '2026-09-26T09:30:00Z' }, { by: 'agent' })
    expect(posts.approve(recent.id).status).toBe('scheduled')
    expect(posts.listDue().map((p) => p.id)).toEqual([recent.id])

    const stale = posts.create({ text: 's', scheduledAt: '2026-09-26T08:59:00Z' }, { by: 'agent' })
    expect(() => posts.approve(stale.id)).toThrow(/more than an hour ago\. Pick a new time/)
    expect(posts.get(stale.id)?.status).toBe('pending_approval')
    expect(posts.approve(stale.id, '2026-09-26T12:00:00Z').status).toBe('scheduled')
  })

  it('only approves or rejects posts that are waiting', () => {
    const mine = posts.create({ text: 'mine', scheduledAt: tomorrow })
    expect(() => posts.approve(mine.id)).toThrow(/scheduled, not waiting for approval/)
    expect(() => posts.reject(mine.id)).toThrow(/only posts waiting for approval can be rejected/)
    expect(() => posts.approve('nope')).toThrow(/No post/)
  })

  it('rejecting keeps the post, read-only, as rejected until it is deleted', () => {
    const pending = posts.create({ text: 'no', scheduledAt: tomorrow }, { by: 'agent' })
    events = []
    expect(posts.reject(pending.id)).toMatchObject({
      status: 'rejected',
      createdBy: 'agent',
      text: 'no'
    })
    expect(events).toEqual([{ ids: [pending.id] }])
    expect(posts.listByDay('2026-09-27').map((p) => [p.id, p.status])).toEqual([
      [pending.id, 'rejected']
    ])
    expect(posts.countsByDay('2026-09-27', '2026-09-27')['2026-09-27']).toMatchObject({
      rejected: 1,
      pending_approval: 0
    })

    expect(() => posts.update(pending.id, { text: 'try again' })).toThrow(/was rejected/)
    expect(() => posts.update(pending.id, { text: 'sneaky' }, { by: 'agent' })).toThrow(
      /was rejected/
    )
    expect(() => posts.reschedule(pending.id, '2026-09-28T09:00:00Z')).toThrow(/was rejected/)
    expect(() => posts.approve(pending.id)).toThrow(/rejected, not waiting for approval/)
    expect(() => posts.reject(pending.id)).toThrow(/only posts waiting for approval/)

    posts.delete(pending.id)
    expect(posts.get(pending.id)).toBeNull()
  })

  it('never hands a rejected post to the publisher', () => {
    const pending = posts.create({ text: 'no', scheduledAt: '2026-09-26T09:30:00Z' }, { by: 'mcp' })
    posts.reject(pending.id)
    expect(posts.listDue()).toEqual([])
    expect(posts.markPosting(pending.id)).toBe(false)
  })

  it('keeps a pending post pending when the user edits it', () => {
    const pending = posts.create({ text: 'draft', scheduledAt: tomorrow }, { by: 'agent' })
    expect(posts.update(pending.id, { text: 'better' })).toMatchObject({
      status: 'pending_approval',
      text: 'better'
    })
    expect(posts.reschedule(pending.id, '2026-09-28T09:00:00Z').status).toBe('pending_approval')
  })

  it("sends a post back for approval when the agent changes it, so it can't approve by editing", () => {
    const mine = posts.create({ text: 'mine', scheduledAt: tomorrow })
    expect(posts.update(mine.id, { text: 'agent edit' }, { by: 'agent' }).status).toBe(
      'pending_approval'
    )
    const other = posts.create({ text: 'other', scheduledAt: tomorrow })
    expect(posts.reschedule(other.id, '2026-09-28T09:00:00Z', { by: 'mcp' }).status).toBe(
      'pending_approval'
    )
    // Anything unknown counts as an agent, never as the user.
    const third = posts.create(
      { text: 'third', scheduledAt: tomorrow },
      {
        by: 'admin' as 'user'
      }
    )
    expect(third.status).toBe('pending_approval')
  })

  it('still retries a failed post of the user as scheduled', () => {
    const post = posts.create({ text: 'a', scheduledAt: '2026-09-26T09:00:00Z' })
    posts.markFailed(post.id, 'missed', 'Missed by more than an hour')
    expect(posts.reschedule(post.id, '2026-09-26T12:00:00Z').status).toBe('scheduled')
  })
})

describe('listRange and listPending', () => {
  it('groups a range by local day across the clock change, earliest first, leaving empty days out', () => {
    // Lisbon: 25 Oct 2026 runs from 23:00Z on the 24th to 00:00Z on the 26th.
    const late24 = posts.create({ text: 'late 24th', scheduledAt: '2026-10-24T21:00:00Z' })
    const first25 = posts.create({ text: 'first 25th', scheduledAt: '2026-10-24T23:00:00Z' })
    const last25 = posts.create({ text: 'last 25th', scheduledAt: '2026-10-25T23:59:00Z' })
    const on27 = posts.create({ text: '27th', scheduledAt: '2026-10-27T09:00:00Z' })
    posts.create({ text: 'outside', scheduledAt: '2026-10-28T09:00:00Z' })

    const range = posts.listRange('2026-10-24', '2026-10-27')

    expect(Object.keys(range)).toEqual(['2026-10-24', '2026-10-25', '2026-10-27'])
    expect(range['2026-10-24'].map((p) => p.id)).toEqual([late24.id])
    expect(range['2026-10-25'].map((p) => p.id)).toEqual([first25.id, last25.id])
    expect(range['2026-10-27'][0]).toEqual(posts.get(on27.id))
  })

  it('returns what listByDay returns for each day, and refuses bad or huge ranges', () => {
    posts.create({ text: 'a', scheduledAt: '2026-09-28T08:00:00Z' })
    posts.create({ scheduledAt: '2026-09-28T09:00:00Z', parts: [{ text: 'one' }, { text: 'two' }] })
    expect(posts.listRange('2026-09-28', '2026-09-28')['2026-09-28']).toEqual(
      posts.listByDay('2026-09-28')
    )
    expect(() => posts.listRange('2026-09-30', '2026-09-28')).toThrow(/end on or after/)
    expect(() => posts.listRange('2026-01-01', '2026-12-31')).toThrow(/at most 62 days/)
    expect(() => posts.listRange('2026-09-01', '2026-11-01')).not.toThrow()
    expect(() => posts.listRange('28/09', '2026-09-30')).toThrow(/Expected a date/)
  })

  it('lists every waiting post from any day, earliest first, and nothing else', () => {
    const later = posts.create(
      { text: 'later', scheduledAt: '2026-12-01T09:00:00Z' },
      { by: 'agent' }
    )
    const sooner = posts.create(
      { text: 'sooner', scheduledAt: '2026-09-27T09:00:00Z' },
      { by: 'mcp' }
    )
    posts.create({ text: 'mine', scheduledAt: '2026-09-28T09:00:00Z' })
    const turnedDown = posts.create(
      { text: 'no', scheduledAt: '2026-09-29T09:00:00Z' },
      { by: 'agent' }
    )
    posts.reject(turnedDown.id)

    expect(posts.listPending().map((p) => p.id)).toEqual([sooner.id, later.id])
    posts.approve(sooner.id)
    expect(posts.listPending().map((p) => p.id)).toEqual([later.id])
  })
})

describe('listByStatus', () => {
  it('lists rejected posts from any day, earliest first, and refuses unknown statuses', () => {
    const dec = posts.create({ text: 'dec', scheduledAt: '2026-12-01T09:00:00Z' }, { by: 'agent' })
    const sep = posts.create(
      { scheduledAt: '2026-09-28T09:00:00Z', parts: [{ text: 'a' }, { text: 'b' }] },
      { by: 'mcp' }
    )
    posts.create({ text: 'waiting', scheduledAt: '2026-10-01T09:00:00Z' }, { by: 'agent' })
    posts.reject(dec.id)
    posts.reject(sep.id)

    const rejected = posts.listByStatus('rejected')
    expect(rejected.map((p) => p.id)).toEqual([sep.id, dec.id])
    expect(rejected[0].parts.map((p) => p.text)).toEqual(['a', 'b'])
    expect(posts.listByStatus('pending_approval')).toEqual(posts.listPending())
    expect(() => posts.listByStatus('binned' as 'rejected')).toThrow(/Unknown post status "binned"/)
  })
})

describe('accounts (OP-63)', () => {
  let active: string | null
  const signedIn = new Set(['alice', 'bob'])

  beforeEach(() => {
    active = 'alice'
    posts.useAccounts({ active: () => active, canPost: (id) => signedIn.has(id) })
  })

  const at = '2026-09-28T09:00:00Z'

  it('shows the active account’s posts, plus posts that have no account yet', () => {
    // Written before any account was connected.
    active = null
    const orphan = posts.create({ text: 'none', scheduledAt: at })
    active = 'alice'
    const mine = posts.create({ text: 'alice', scheduledAt: at })
    const bobs = posts.create({ text: 'bob', scheduledAt: at, accountId: 'bob' })
    expect([orphan.accountId, mine.accountId]).toEqual([null, 'alice'])

    const ids = (list: { id: string }[]): string[] => list.map((p) => p.id).sort()
    expect(ids(posts.listByDay('2026-09-28'))).toEqual(ids([mine, orphan]))
    expect(ids(posts.listByDay('2026-09-28', 'bob'))).toEqual(ids([bobs, orphan]))
    expect(posts.listByDay('2026-09-28', null)).toHaveLength(3)
    active = 'bob'
    expect(ids(posts.listRange('2026-09-28', '2026-09-28')['2026-09-28']!)).toEqual(
      ids([bobs, orphan])
    )
    expect(posts.countsByDay('2026-09-28', '2026-09-28')['2026-09-28']?.scheduled).toBe(2)
    expect(posts.countsByDay('2026-09-28', '2026-09-28', null)['2026-09-28']?.scheduled).toBe(3)
  })

  it('counts waiting posts for the active account, all accounts, and each account', () => {
    posts.create({ text: 'a1', scheduledAt: at }, { by: 'agent' })
    posts.create({ text: 'a2', scheduledAt: '2026-09-30T09:00:00Z' }, { by: 'agent' })
    posts.create(
      { text: 'b1', scheduledAt: '2026-09-27T09:00:00Z', accountId: 'bob' },
      { by: 'mcp' }
    )

    expect(posts.pending()).toEqual({ count: 2, first: '2026-09-28' })
    expect(posts.pending('bob')).toEqual({ count: 1, first: '2026-09-27' })
    expect(posts.pending(null)).toEqual({ count: 3, first: '2026-09-27' })
    expect(posts.listPending().map((p) => p.text)).toEqual(['a1', 'a2'])
    expect(posts.listByStatus('pending_approval', 'bob').map((p) => p.text)).toEqual(['b1'])
    expect(posts.pendingByAccount()).toEqual({ alice: 2, bob: 1 })
  })

  it('moves a post to another signed-in account, keeping the status rules', () => {
    const waiting = posts.create({ text: 'w', scheduledAt: at }, { by: 'agent' })
    const failed = posts.create({ text: 'f', scheduledAt: at })
    posts.markPosting(failed.id)
    posts.markFailed(failed.id, 'auth', 'X signed you out')

    expect(posts.update(waiting.id, { accountId: 'bob' })).toMatchObject({
      accountId: 'bob',
      status: 'pending_approval'
    })
    expect(posts.update(failed.id, { accountId: 'bob' })).toMatchObject({
      accountId: 'bob',
      status: 'scheduled',
      errorCode: null
    })
    expect(() => posts.update(waiting.id, { accountId: 'carol' })).toThrow(/signed-in X accounts/)
  })

  it('keeps a thread that is partly on X on the account it started from', () => {
    const post = posts.create({ scheduledAt: at, parts: [{ text: 'one' }, { text: 'two' }] })
    posts.markPosting(post.id)
    posts.markPartPosted(post.parts[0].id, { remoteId: '1', remoteUrl: 'u1' })
    posts.markFailed(post.id, 'retries_exhausted', 'X is down')

    expect(() => posts.update(post.id, { accountId: 'bob' })).toThrow(/same account/)
    // It can still be fixed and retried from where it started.
    expect(posts.update(post.id, { accountId: 'alice' })).toMatchObject({
      accountId: 'alice',
      status: 'scheduled'
    })
  })

  it('refuses to move a post that is going out or already on X', () => {
    const post = posts.create({ text: 'p', scheduledAt: at })
    posts.markPosting(post.id)
    expect(() => posts.update(post.id, { accountId: 'bob' })).toThrow(/posting/)
  })
})
