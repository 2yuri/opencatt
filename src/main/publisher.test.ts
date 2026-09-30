import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Post, XAccount } from '@shared/api'
import { openDatabase } from './db/database'
import { PostsService } from './db/posts'
import {
  CHECK_EVERY_MS,
  MISSED_ERROR,
  Publisher,
  RETRY_DELAYS_MS,
  UNCERTAIN_ERROR,
  type PublisherDeps
} from './publisher'
import { XError, postUrl, type PublishedPart } from './x/client'

let clock: Date
let posts: PostsService
let publish: ReturnType<typeof vi.fn>
let timers: { run: () => void; ms: number }[]
let signedOut: (XAccount | null)[]
let publisher: Publisher

const alice: XAccount = {
  id: 'alice',
  platform: 'x',
  handle: 'alice',
  name: null,
  avatarUrl: null,
  mode: 'oauth2',
  needsReconnect: false
}

let nextRemote = 100
/** Publishes every part, like X answering 201 each time. */
const ok = async (
  post: Post,
  onPart: (partId: string, remote: PublishedPart) => void
): Promise<PublishedPart> => {
  let head: PublishedPart | null = null
  for (const part of post.parts) {
    if (part.remoteId) continue
    const remote = { remoteId: String(++nextRemote), remoteUrl: postUrl(String(nextRemote)) }
    onPart(part.id, remote)
    head ??= remote
  }
  return head!
}

function build(overrides: Partial<PublisherDeps> = {}): Publisher {
  return new Publisher({
    posts,
    publish: publish as unknown as PublisherDeps['publish'],
    account: (id) => (id === 'alice' ? alice : null),
    now: () => clock,
    setTimer: (run, ms) => timers.push({ run, ms }),
    clearTimer: () => {},
    onSignedOut: (account) => signedOut.push(account),
    ...overrides
  })
}

beforeEach(() => {
  nextRemote = 100
  clock = new Date('2026-09-28T09:00:00Z')
  posts = new PostsService(openDatabase(':memory:'), () => clock)
  publish = vi.fn(ok)
  timers = []
  signedOut = []
  publisher = build()
})

const create = (at: string, fields: { parts?: { text: string }[] } = {}): Post =>
  posts.create({
    text: fields.parts ? undefined : 'hello',
    scheduledAt: at,
    accountId: 'alice',
    ...fields
  })

describe('Publisher', () => {
  it('posts what is due, as its own account, and leaves the rest', async () => {
    const due = create('2026-09-28T08:59:00Z')
    const later = create('2026-09-28T10:00:00Z')
    await publisher.start()

    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0]![0]).toMatchObject({
      id: due.id,
      accountId: 'alice',
      status: 'posting'
    })
    expect(posts.get(due.id)).toMatchObject({ status: 'posted', remoteId: '101' })
    expect(posts.get(later.id)?.status).toBe('scheduled')
    // Sleeps until the next post is due, but never longer than the check interval.
    expect(timers.at(-1)?.ms).toBe(CHECK_EVERY_MS)
  })

  it('wakes exactly when the next post is due within the check interval', async () => {
    create('2026-09-28T09:00:10Z')
    await publisher.start()
    expect(timers.at(-1)?.ms).toBe(10_000)
    clock = new Date('2026-09-28T09:00:10Z')
    timers.at(-1)!.run()
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
  })

  it('records each part of a thread as it goes out', async () => {
    const thread = create('2026-09-28T09:00:00Z', { parts: [{ text: 'a' }, { text: 'b' }] })
    await publisher.start()
    const done = posts.get(thread.id)!
    expect(done.status).toBe('posted')
    expect(done.parts.map((p) => p.remoteId)).toEqual(['101', '102'])
  })

  it('fails a post more than an hour late as missed, and one left posting as uncertain', async () => {
    const missed = create('2026-09-28T07:30:00Z')
    const stuck = create('2026-09-28T08:55:00Z')
    posts.markPosting(stuck.id)
    await publisher.start()

    expect(posts.get(missed.id)).toMatchObject({
      status: 'failed',
      errorCode: 'missed',
      error: MISSED_ERROR
    })
    expect(posts.get(stuck.id)).toMatchObject({
      status: 'failed',
      errorCode: 'uncertain',
      error: UNCERTAIN_ERROR
    })
    expect(publish).not.toHaveBeenCalled()
  })

  it('retries after 1, 5 and 15 minutes, then gives up', async () => {
    publish.mockRejectedValue(new XError('retryable', 'X said: Service Unavailable', 503))
    const post = create('2026-09-28T09:00:00Z')
    await publisher.start()

    for (const delay of RETRY_DELAYS_MS) {
      const retried = posts.get(post.id)!
      expect(retried.status).toBe('scheduled')
      // The time the user picked stays; the retry has its own time (OP-69).
      expect(retried.scheduledAt).toBe('2026-09-28T09:00:00.000Z')
      expect(Date.parse(retried.nextAttemptAt!) - clock.getTime()).toBe(delay)
      clock = new Date(retried.nextAttemptAt!)
      await publisher.poke()
    }
    expect(posts.get(post.id)).toMatchObject({
      status: 'failed',
      errorCode: 'retries_exhausted',
      error: 'X said: Service Unavailable',
      scheduledAt: '2026-09-28T09:00:00.000Z',
      nextAttemptAt: null
    })
    expect(publish).toHaveBeenCalledTimes(4)
  })

  it('waits for X’s rate-limit reset when it is later than the backoff', async () => {
    const reset = new Date('2026-09-28T09:12:00Z')
    publish.mockRejectedValueOnce(new XError('retryable', 'X said: Too Many Requests', 429, reset))
    const post = create('2026-09-28T09:00:00Z')
    await publisher.start()
    expect(posts.get(post.id)?.nextAttemptAt).toBe(reset.toISOString())
  })

  it('fails at once when X refuses the post or the account is signed out, telling the user once', async () => {
    const refused = create('2026-09-28T09:00:00Z')
    const signed1 = create('2026-09-28T09:00:00Z')
    const signed2 = create('2026-09-28T09:00:00Z')
    publish
      .mockRejectedValueOnce(new XError('rejected', 'X said: duplicate content', 403))
      .mockRejectedValueOnce(new XError('auth', 'X said: Unauthorized', 401))
      .mockRejectedValueOnce(new XError('auth', 'X said: Unauthorized', 401))
    await publisher.start()

    expect(posts.get(refused.id)).toMatchObject({
      status: 'failed',
      errorCode: 'rejected',
      error: 'X said: duplicate content'
    })
    for (const id of [signed1.id, signed2.id]) {
      expect(posts.get(id)).toMatchObject({
        status: 'failed',
        errorCode: 'auth',
        error: 'X signed out @alice. Reconnect @alice to post this.'
      })
    }
    expect(signedOut).toEqual([alice])
  })

  it('fails a post whose answer X lost as uncertain, and never resends it', async () => {
    publish.mockRejectedValueOnce(
      new XError('uncertain', 'X didn’t answer after the post was sent, so it may be on X already.')
    )
    const post = create('2026-09-28T09:00:00Z')
    await publisher.start()
    expect(posts.get(post.id)).toMatchObject({ status: 'failed', errorCode: 'uncertain' })
    await publisher.poke()
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('treats an unexpected error as uncertain, since the post may already be out', async () => {
    publish.mockRejectedValueOnce(new TypeError('database is locked'))
    const post = create('2026-09-28T09:00:00Z')
    await publisher.start()
    expect(posts.get(post.id)).toMatchObject({ status: 'failed', errorCode: 'uncertain' })
    expect(posts.get(post.id)?.error).toMatch(/may be on X already.*database is locked/)
  })

  it('fails as uncertain when recording a part that X already took throws', async () => {
    const post = create('2026-09-28T09:00:00Z')
    vi.spyOn(posts, 'markPartPosted').mockImplementationOnce(() => {
      throw new Error('disk I/O error')
    })
    await publisher.start()
    expect(posts.get(post.id)).toMatchObject({ status: 'failed', errorCode: 'uncertain' })
    await publisher.poke()
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('keeps going through the pass when one post can’t be settled', async () => {
    const first = create('2026-09-28T08:59:00Z')
    const second = create('2026-09-28T09:00:00Z')
    publish.mockRejectedValueOnce(new XError('rejected', 'X said: no'))
    vi.spyOn(posts, 'markFailed').mockImplementationOnce(() => {
      throw new Error(`Post ${first.id} is not scheduled or posting, so it cannot fail`)
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await publisher.start()
    expect(posts.get(second.id)?.status).toBe('posted')
  })

  it('fails at once when X’s rate limit lifts more than an hour after the post’s time', async () => {
    const post = create('2026-09-28T09:00:00Z')
    // X's daily cap: lifts tomorrow morning.
    publish.mockRejectedValueOnce(
      new XError('retryable', 'X said: Too Many Requests', 429, new Date('2026-09-29T08:30:00Z'))
    )
    await publisher.start()
    expect(posts.get(post.id)).toMatchObject({
      status: 'failed',
      errorCode: 'retries_exhausted',
      nextAttemptAt: null
    })
    expect(posts.get(post.id)?.error).toMatch(/more than an hour after this post's time/)
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('is missed when the app slept through a retry by more than an hour', async () => {
    const post = create('2026-09-28T09:00:00Z')
    publish.mockRejectedValueOnce(new XError('retryable', 'X said: Service Unavailable', 503))
    await publisher.start()
    // The retry was due at 09:01; the app wakes at 10:30.
    clock = new Date('2026-09-28T10:30:00Z')
    await publisher.poke()
    expect(posts.get(post.id)).toMatchObject({ status: 'failed', errorCode: 'missed' })
  })

  it('sends other due posts while X processes a video, and comes back for it (OP-70)', async () => {
    const video = create('2026-09-28T08:59:00Z')
    const text = create('2026-09-28T09:00:00Z')
    publish.mockRejectedValueOnce(
      new XError(
        'processing',
        'X is still processing the video.',
        null,
        new Date('2026-09-28T09:00:05Z')
      )
    )
    await publisher.start()
    expect(posts.get(text.id)?.status).toBe('posted')
    expect(posts.get(video.id)).toMatchObject({
      status: 'scheduled',
      nextAttemptAt: '2026-09-28T09:00:05.000Z'
    })
    clock = new Date('2026-09-28T09:00:05Z')
    await publisher.poke()
    expect(posts.get(video.id)?.status).toBe('posted')
  })

  it('doesn’t count waiting on X’s processing as a retry', async () => {
    const post = create('2026-09-28T09:00:00Z')
    for (let i = 0; i < 6; i++) {
      publish.mockRejectedValueOnce(
        new XError(
          'processing',
          'X is still processing the video.',
          null,
          new Date(clock.getTime() + 5000)
        )
      )
    }
    await publisher.start()
    for (let i = 0; i < 6; i++) {
      clock = new Date(posts.get(post.id)!.nextAttemptAt!)
      await publisher.poke()
    }
    expect(posts.get(post.id)?.status).toBe('posted')
  })

  it('uploads the videos of posts due in the next 30 minutes, after what is due', async () => {
    const prepare = vi.fn((post: Post) => Promise.resolve(void post))
    publisher.stop()
    publisher = build({ prepare })
    const video = posts.create({
      scheduledAt: '2026-09-28T09:20:00Z',
      accountId: 'alice',
      parts: [{ text: 'clip' }]
    })
    const media = {
      id: 'm1',
      kind: 'video' as const,
      mime: 'video/mp4',
      bytes: 1,
      width: 1,
      height: 1,
      durationMs: 1000,
      alt: null,
      url: ''
    }
    vi.spyOn(posts, 'listDue').mockImplementation((at?: Date) =>
      at && at.getTime() > clock.getTime()
        ? [
            {
              ...posts.get(video.id)!,
              parts: [{ ...posts.get(video.id)!.parts[0]!, media: [media] }]
            }
          ]
        : []
    )
    await publisher.start()
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
    expect(prepare.mock.calls[0]![0]).toMatchObject({ id: video.id })
  })

  it('sends a post that becomes due while a video is still uploading', async () => {
    let finishUpload!: () => void
    const prepare = vi.fn(() => new Promise<void>((resolve) => (finishUpload = resolve)))
    publisher.stop()
    publisher = build({ prepare })
    const media = {
      id: 'm1',
      kind: 'video' as const,
      mime: 'video/mp4',
      bytes: 1,
      width: 1,
      height: 1,
      durationMs: 1000,
      alt: null,
      url: ''
    }
    const video = posts.create({
      scheduledAt: '2026-09-28T09:20:00Z',
      accountId: 'alice',
      parts: [{ text: 'clip' }]
    })
    const realListDue = posts.listDue.bind(posts)
    vi.spyOn(posts, 'listDue').mockImplementation((at?: Date) =>
      realListDue(at).map((p) =>
        p.id === video.id ? { ...p, parts: [{ ...p.parts[0]!, media: [media] }] } : p
      )
    )
    await publisher.start()
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
    // The upload is still running when a text post becomes due.
    const text = create('2026-09-28T09:00:00Z')
    await publisher.poke()
    expect(posts.get(text.id)?.status).toBe('posted')
    finishUpload()
  })

  it('says to connect an account, not that one was signed out, for a post with no account', async () => {
    const post = posts.create({ text: 'hi', scheduledAt: '2026-09-28T09:00:00Z' })
    publish.mockRejectedValueOnce(new XError('auth', 'Connect an X account to post this.'))
    await publisher.start()
    expect(posts.get(post.id)).toMatchObject({
      status: 'failed',
      errorCode: 'auth',
      error: 'Connect an X account to post this.'
    })
    expect(signedOut).toEqual([])
  })

  it('fails a post for a platform OpenCatt can’t post to yet, without sending or retrying (OP-118)', async () => {
    const tiktok: XAccount = { ...alice, id: 'tiktok:1', platform: 'tiktok', handle: 'tt' }
    const other = vi.fn(ok)
    publisher = build({
      account: (id) => (id === 'alice' ? alice : id === tiktok.id ? tiktok : null),
      publishers: { tiktok: other as unknown as PublisherDeps['publish'] }
    })
    const post = posts.create({
      text: 'hello',
      scheduledAt: '2026-09-28T08:59:00Z',
      accountId: tiktok.id
    })
    const onX = create('2026-09-28T08:59:00Z')
    await publisher.start()

    expect(posts.get(post.id)).toMatchObject({
      status: 'failed',
      errorCode: 'rejected',
      error: "OpenCatt can't post to TikTok yet."
    })
    expect(other).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledTimes(1)
    expect(posts.get(onX.id)?.status).toBe('posted')
  })

  it('never sends a post edited or claimed since it was listed', async () => {
    const post = create('2026-09-28T09:00:00Z')
    const spy = vi.spyOn(posts, 'markPosting').mockReturnValueOnce(false)
    await publisher.start()
    expect(spy).toHaveBeenCalledWith(post.id)
    expect(publish).not.toHaveBeenCalled()
  })

  it('runs one pass at a time, and again after one that was poked mid-run', async () => {
    let release!: () => void
    publish.mockImplementationOnce(
      (post: Post, onPart: (id: string, r: PublishedPart) => void) =>
        new Promise<PublishedPart>((resolve) => {
          release = () => void ok(post, onPart).then(resolve)
        })
    )
    const first = create('2026-09-28T09:00:00Z')
    const running = publisher.start()
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1))
    const second = create('2026-09-28T09:00:00Z')
    const poked = publisher.poke()
    expect(publish).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([running, poked])
    expect(posts.get(first.id)?.status).toBe('posted')
    expect(posts.get(second.id)?.status).toBe('posted')
  })

  it('does nothing once stopped', async () => {
    publisher.stop()
    create('2026-09-28T09:00:00Z')
    await publisher.poke()
    expect(publish).not.toHaveBeenCalled()
  })
})
