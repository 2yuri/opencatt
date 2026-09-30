import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Post, PostMedia, PostPart } from '@shared/api'
import { AuthError } from '@shared/authErrors'
import { ReconnectNeededError, type XCredentials } from '../auth/service'
import { XClient, XError, postUrl, type XAccountAuth } from './client'

const dir = mkdtempSync(join(tmpdir(), 'opencat-x-'))
const file = (name: string, bytes: number): string => {
  const path = join(dir, name)
  writeFileSync(path, Buffer.alloc(bytes, 1))
  return path
}
const paths: Record<string, string> = {
  small: file('small.png', 1000),
  huge: file('huge.png', 6 * 1024 * 1024),
  gif: file('anim.gif', 2000),
  // Two full 4 MB chunks and a short one.
  video: file('clip.mp4', 9 * 1024 * 1024)
}

const media = (id: string, fields: Partial<PostMedia> = {}): PostMedia => ({
  id,
  kind: 'image',
  mime: 'image/png',
  bytes: 1000,
  width: 10,
  height: 10,
  durationMs: null,
  alt: null,
  url: `opencat-media://media/${id}`,
  ...fields
})

const part = (i: number, fields: Partial<PostPart> = {}): PostPart => ({
  id: `part-${i}`,
  position: i,
  text: `part ${i}`,
  media: [],
  remoteId: null,
  remoteUrl: null,
  postedAt: null,
  ...fields
})

const post = (parts: PostPart[], accountId: string | null = 'acct'): Post => ({
  id: 'post-1',
  accountId,
  createdBy: 'user',
  autopilot: false,
  text: parts[0]!.text,
  parts,
  scheduledAt: '2026-09-28T09:00:00.000Z',
  nextAttemptAt: null,
  status: 'posting',
  postedAt: null,
  remoteId: null,
  remoteUrl: null,
  error: null,
  errorCode: null,
  createdAt: '2026-09-27T09:00:00.000Z',
  updatedAt: '2026-09-27T09:00:00.000Z'
})

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })

interface Call {
  url: string
  auth: string
  body: unknown
}

/** X, answering from `answers` in order per path (the last one repeats), with ids 1001, 1002… */
function setup(
  options: {
    credentials?: XCredentials
    answers?: Record<string, (() => Response | Promise<Response>)[]>
    auth?: Partial<XAccountAuth>
  } = {}
) {
  const calls: Call[] = []
  let nextId = 1000
  const answers = options.answers ?? {}
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const path = new URL(url).pathname
    const body =
      init?.body instanceof FormData
        ? Object.fromEntries(
            [...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : 'file'])
          )
        : init?.body
          ? JSON.parse(String(init.body))
          : null
    calls.push({ url, auth: new Headers(init?.headers).get('Authorization') ?? '', body })
    const queue = answers[path + (url.includes('command=STATUS') ? '?STATUS' : '')]
    if (queue && queue.length > 0) return (queue.length > 1 ? queue.shift()! : queue[0]!)()
    if (path === '/2/tweets') return json(201, { data: { id: String(++nextId), text: '' } })
    if (path === '/2/media/upload' && url.includes('command=STATUS')) {
      return json(200, { data: { processing_info: { state: 'succeeded' } } })
    }
    if (path === '/2/media/upload') return json(200, { data: { id: `m${++nextId}` } })
    if (path === '/2/media/upload/initialize') return json(200, { data: { id: 'v1' } })
    if (path.endsWith('/append')) return new Response(null, { status: 204 })
    if (path.endsWith('/finalize')) {
      return json(200, {
        data: { id: 'v1', processing_info: { state: 'pending', check_after_secs: 2 } }
      })
    }
    if (path === '/2/media/metadata') return json(200, { data: {} })
    return json(404, {})
  })
  const credentials: XCredentials = options.credentials ?? { mode: 'oauth2', accessToken: 'tok' }
  const auth: XAccountAuth = {
    credentialsFor: vi.fn(async () => credentials),
    forceRefresh: vi.fn(async () => ({ mode: 'oauth2', accessToken: 'tok-2' }) as XCredentials),
    ...options.auth
  }
  const clock = { now: new Date('2026-09-28T09:00:00Z') }
  const client = new XClient({
    now: () => clock.now,
    auth,
    mediaPath: (id) => paths[id] ?? join(dir, 'missing.png'),
    fetch: fetchImpl as unknown as typeof fetch
  })
  const posted: [string, string][] = []
  const onPart = (partId: string, remote: { remoteId: string }): void => {
    posted.push([partId, remote.remoteId])
  }
  const advance = (ms: number): void => {
    clock.now = new Date(clock.now.getTime() + ms)
  }
  return { client, calls, auth, posted, onPart, advance }
}

describe('XClient.publish', () => {
  it('posts a single part with the account’s bearer token', async () => {
    const t = setup()
    await expect(t.client.publish(post([part(0)]), t.onPart)).resolves.toEqual({
      remoteId: '1001',
      remoteUrl: postUrl('1001')
    })
    expect(t.auth.credentialsFor).toHaveBeenCalledWith('acct')
    expect(t.calls).toEqual([
      { url: 'https://api.x.com/2/tweets', auth: 'Bearer tok', body: { text: 'part 0' } }
    ])
    expect(t.posted).toEqual([['part-0', '1001']])
  })

  it('chains a thread as replies and resumes from the first part not on X', async () => {
    const t = setup()
    const thread = post([part(0, { remoteId: '900', remoteUrl: postUrl('900') }), part(1), part(2)])
    await expect(t.client.publish(thread, t.onPart)).resolves.toEqual({
      remoteId: '900',
      remoteUrl: postUrl('900')
    })
    expect(t.calls.map((c) => c.body)).toEqual([
      { text: 'part 1', reply: { in_reply_to_tweet_id: '900' } },
      { text: 'part 2', reply: { in_reply_to_tweet_id: '1001' } }
    ])
    expect(t.posted).toEqual([
      ['part-1', '1001'],
      ['part-2', '1002']
    ])
  })

  it('uploads images and GIFs, sets alt text, and attaches their ids', async () => {
    const t = setup()
    const withMedia = part(0, {
      media: [media('small', { alt: 'A cat' }), media('gif', { kind: 'gif', mime: 'image/gif' })]
    })
    await t.client.publish(post([withMedia]), t.onPart)
    expect(t.calls.map((c) => [new URL(c.url).pathname, c.body])).toEqual([
      ['/2/media/upload', { media_category: 'tweet_image', media: 'file' }],
      ['/2/media/metadata', { id: 'm1001', metadata: { alt_text: { text: 'A cat' } } }],
      ['/2/media/upload', { media_category: 'tweet_gif', media: 'file' }],
      ['/2/tweets', { text: 'part 0', media: { media_ids: ['m1001', 'm1002'] } }]
    ])
  })

  it('refuses media X would refuse before uploading anything', async () => {
    const t = setup()
    await expect(
      t.client.publish(post([part(0, { media: [media('huge')] })]), t.onPart)
    ).rejects.toMatchObject({ kind: 'rejected', message: 'X takes images up to 5 MB.' })
    await expect(
      t.client.publish(
        post([
          part(0, {
            media: [media('video', { kind: 'video', mime: 'video/mp4', durationMs: 150_000 })]
          })
        ]),
        t.onPart
      )
    ).rejects.toMatchObject({
      kind: 'rejected',
      message: 'X takes videos up to 2 minutes 20 seconds.'
    })
    expect(t.calls).toEqual([])
  })

  it('signs every call with OAuth 1.0a keys', async () => {
    const keys = {
      apiKey: 'xvz1evFS4wEEPTGEFPHBog',
      apiKeySecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
      accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      accessTokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE'
    }
    const t = setup({ credentials: { mode: 'oauth1', keys } })
    await t.client.publish(post([part(0, { media: [media('small')] })]), t.onPart)
    expect(t.calls).toHaveLength(2)
    for (const call of t.calls) {
      expect(call.auth).toMatch(/^OAuth .*oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"/)
      expect(call.auth).toContain('oauth_signature_method="HMAC-SHA1"')
    }
  })
})

describe('XClient errors', () => {
  it('refreshes the token once on a 401 and retries', async () => {
    const t = setup({
      answers: { '/2/tweets': [() => json(401, {}), () => json(201, { data: { id: '7' } })] }
    })
    await expect(t.client.publish(post([part(0)]), t.onPart)).resolves.toMatchObject({
      remoteId: '7'
    })
    expect(t.auth.forceRefresh).toHaveBeenCalledTimes(1)
    expect(t.calls.map((c) => c.auth)).toEqual(['Bearer tok', 'Bearer tok-2'])
  })

  it('is auth when X still refuses after the refresh, or the account must sign in again', async () => {
    const stillRefused = setup({
      answers: { '/2/tweets': [() => json(401, { title: 'Unauthorized' })] }
    })
    await expect(
      stillRefused.client.publish(post([part(0)]), stillRefused.onPart)
    ).rejects.toMatchObject({
      kind: 'auth',
      message: 'X said: Unauthorized'
    })

    const signedOut = setup({
      auth: { credentialsFor: vi.fn().mockRejectedValue(new ReconnectNeededError('acct')) }
    })
    await expect(signedOut.client.publish(post([part(0)]), signedOut.onPart)).rejects.toMatchObject(
      {
        kind: 'auth'
      }
    )

    const none = setup()
    await expect(none.client.publish(post([part(0)], null), none.onPart)).rejects.toMatchObject({
      kind: 'auth'
    })
  })

  it('is retryable with the reset time on a 429', async () => {
    const t = setup({
      answers: {
        '/2/tweets': [
          () => json(429, { title: 'Too Many Requests' }, { 'x-rate-limit-reset': '1790500000' })
        ]
      }
    })
    const err = (await t.client.publish(post([part(0)]), t.onPart).catch((e) => e)) as XError
    expect(err).toBeInstanceOf(XError)
    expect(err.kind).toBe('retryable')
    expect(err.status).toBe(429)
    expect(err.resetAt).toEqual(new Date(1790500000 * 1000))
  })

  it('is retryable when media can’t go up, or X can’t be reached before anything is sent', async () => {
    const down = setup({ answers: { '/2/media/upload': [() => json(503, {})] } })
    await expect(
      down.client.publish(post([part(0, { media: [media('small')] })]), down.onPart)
    ).rejects.toMatchObject({ kind: 'retryable', status: 503 })
    const offline = setup({
      auth: { credentialsFor: vi.fn().mockRejectedValue(new AuthError('network')) }
    })
    await expect(offline.client.publish(post([part(0)]), offline.onPart)).rejects.toMatchObject({
      kind: 'retryable'
    })
  })

  it('is uncertain, never retryable, when a post was sent and X’s answer was lost', async () => {
    const lost = (answer: () => Response | Promise<Response>) =>
      setup({ answers: { '/2/tweets': [answer] } })
    const outcomes = [
      lost(() => json(503, { title: 'Service Unavailable' })),
      lost(() => Promise.reject(new TypeError('socket hang up'))),
      lost(() => new Response('{"data":', { status: 201 }))
    ]
    for (const t of outcomes) {
      const err = (await t.client.publish(post([part(0)]), t.onPart).catch((e) => e)) as XError
      expect(err.kind).toBe('uncertain')
      expect(err.message).toMatch(/may be on X already/)
    }
  })

  it('is rejected, with X’s own words, when X refuses the post', async () => {
    const t = setup({
      answers: {
        '/2/tweets': [
          () =>
            json(403, {
              detail: 'You are not allowed to create a Tweet with duplicate content.'
            })
        ]
      }
    })
    await expect(t.client.publish(post([part(0)]), t.onPart)).rejects.toMatchObject({
      kind: 'rejected',
      status: 403,
      message: 'X said: You are not allowed to create a Tweet with duplicate content.'
    })
  })

  it('keeps the parts already posted when a later part is lost', async () => {
    const t = setup({
      answers: {
        '/2/tweets': [() => json(201, { data: { id: '1' } }), () => json(503, {})]
      }
    })
    await expect(t.client.publish(post([part(0), part(1)]), t.onPart)).rejects.toMatchObject({
      kind: 'uncertain'
    })
    expect(t.posted).toEqual([['part-0', '1']])
  })

  it('checks and uploads every part’s media before posting any part', async () => {
    const bad = setup()
    const thread = post([part(0), part(1), part(2, { media: [media('huge')] })])
    await expect(bad.client.publish(thread, bad.onPart)).rejects.toMatchObject({
      kind: 'rejected',
      message: 'X takes images up to 5 MB.'
    })
    expect(bad.calls).toEqual([])

    const ok = setup()
    await ok.client.publish(
      post([
        part(0, { media: [media('small')] }),
        part(1, { media: [media('gif', { kind: 'gif', mime: 'image/gif' })] })
      ]),
      ok.onPart
    )
    expect(ok.calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/2/media/upload',
      '/2/media/upload',
      '/2/tweets',
      '/2/tweets'
    ])
  })
})

describe('XClient video (OP-18, OP-70)', () => {
  const clip = media('video', { kind: 'video', mime: 'video/mp4', durationMs: 30_000 })
  const steps = (calls: { url: string }[]): string[] =>
    calls.map((c) => {
      const url = new URL(c.url)
      const command = url.searchParams.get('command')
      return url.pathname + (command ? `?${command}` : '')
    })

  it('uploads in chunks and, while X is still processing, says when to look again', async () => {
    const t = setup({
      answers: {
        '/2/media/upload?STATUS': [
          () =>
            json(200, { data: { processing_info: { state: 'in_progress', check_after_secs: 5 } } })
        ]
      }
    })
    const err = (await t.client
      .publish(post([part(0, { media: [clip] })]), t.onPart)
      .catch((e) => e)) as XError
    expect(err).toMatchObject({ kind: 'processing' })
    expect(err.resetAt).toEqual(new Date('2026-09-28T09:00:05Z'))
    expect(steps(t.calls)).toEqual([
      '/2/media/upload/initialize',
      '/2/media/upload/v1/append',
      '/2/media/upload/v1/append',
      '/2/media/upload/v1/append',
      '/2/media/upload/v1/finalize',
      '/2/media/upload?STATUS'
    ])
    expect(t.calls[0]!.body).toEqual({
      media_type: 'video/mp4',
      total_bytes: 9 * 1024 * 1024,
      media_category: 'tweet_video'
    })
    expect(
      t.calls.slice(1, 4).map((c) => (c.body as { segment_index: string }).segment_index)
    ).toEqual(['0', '1', '2'])
    expect(t.posted).toEqual([])
  })

  it('posts on the next try with the same upload once X is done, without uploading again', async () => {
    const t = setup({
      answers: {
        '/2/media/upload?STATUS': [
          () =>
            json(200, { data: { processing_info: { state: 'in_progress', check_after_secs: 3 } } }),
          () => json(200, { data: { processing_info: { state: 'succeeded' } } })
        ]
      }
    })
    const thePost = post([part(0, { media: [clip] })])
    await expect(t.client.publish(thePost, t.onPart)).rejects.toMatchObject({ kind: 'processing' })
    t.advance(3000)
    t.calls.length = 0
    await t.client.publish(thePost, t.onPart)
    expect(steps(t.calls)).toEqual(['/2/media/upload?STATUS', '/2/tweets'])
    expect(t.calls.at(-1)!.body).toEqual({ text: 'part 0', media: { media_ids: ['v1'] } })
  })

  it('uploads ahead of time with prepare(), so the due post goes straight out', async () => {
    const t = setup({
      answers: {
        '/2/media/upload?STATUS': [
          () => json(200, { data: { processing_info: { state: 'succeeded' } } })
        ]
      }
    })
    const thePost = post([part(0, { media: [clip] })])
    await t.client.prepare(thePost)
    expect(steps(t.calls).at(-1)).toBe('/2/media/upload/v1/finalize')
    t.advance(20 * 60 * 1000)
    t.calls.length = 0
    await t.client.publish(thePost, t.onPart)
    expect(steps(t.calls)).toEqual(['/2/media/upload?STATUS', '/2/tweets'])
  })

  it('waits 5 minutes before trying a failed early upload again', async () => {
    const t = setup({ answers: { '/2/media/upload/initialize': [() => json(503, {})] } })
    const thePost = post([part(0, { media: [clip] })])
    await t.client.prepare(thePost)
    t.advance(30_000)
    await t.client.prepare(thePost)
    const inits = (): number => t.calls.filter((c) => c.url.endsWith('/initialize')).length
    expect(inits()).toBe(1)
    t.advance(5 * 60 * 1000)
    await t.client.prepare(thePost)
    expect(inits()).toBe(2)
  })

  it('uploads again once an earlier upload is older than 20 hours', async () => {
    const t = setup({
      answers: {
        '/2/media/upload?STATUS': [
          () => json(200, { data: { processing_info: { state: 'succeeded' } } })
        ]
      }
    })
    const thePost = post([part(0, { media: [clip] })])
    await t.client.prepare(thePost)
    t.advance(21 * 60 * 60 * 1000)
    t.calls.length = 0
    await t.client.publish(thePost, t.onPart)
    expect(steps(t.calls)[0]).toBe('/2/media/upload/initialize')
  })

  it('is rejected, with X’s reason, when X can’t process the video', async () => {
    const t = setup({
      answers: {
        '/2/media/upload?STATUS': [
          () =>
            json(200, {
              data: {
                processing_info: {
                  state: 'failed',
                  error: { name: 'InvalidMedia', message: 'Unsupported video codec' }
                }
              }
            })
        ]
      }
    })
    await expect(
      t.client.publish(post([part(0, { media: [clip] })]), t.onPart)
    ).rejects.toMatchObject({
      kind: 'rejected',
      message: "X couldn't use this video: Unsupported video codec"
    })
    expect(t.calls.some((c) => c.url.endsWith('/2/tweets'))).toBe(false)
  })

  it('is retryable when X is still processing 10 minutes after the upload', async () => {
    const t = setup({
      answers: {
        '/2/media/upload?STATUS': [
          () =>
            json(200, { data: { processing_info: { state: 'in_progress', check_after_secs: 60 } } })
        ]
      }
    })
    const thePost = post([part(0, { media: [clip] })])
    await expect(t.client.publish(thePost, t.onPart)).rejects.toMatchObject({ kind: 'processing' })
    t.advance(10 * 60 * 1000)
    await expect(t.client.publish(thePost, t.onPart)).rejects.toMatchObject({ kind: 'retryable' })
  })
})

describe('XClient.readTimeline (OP-109)', () => {
  it("reads the account's last posts with their public stats, reposts left out", async () => {
    const calls: string[] = []
    const client = new XClient({
      auth: {
        credentialsFor: async () => ({ mode: 'oauth2', accessToken: 't' }) as never,
        forceRefresh: async () => ({ mode: 'oauth2', accessToken: 't' }) as never
      },
      mediaPath: () => '',
      fetch: (async (url: string) => {
        calls.push(url)
        return new Response(
          JSON.stringify({
            data: [
              {
                id: '9',
                text: 'hi',
                created_at: '2026-09-29T10:00:00.000Z',
                public_metrics: {
                  impression_count: 120,
                  like_count: 4,
                  retweet_count: 1,
                  reply_count: 2,
                  quote_count: 0,
                  bookmark_count: 3
                }
              }
            ]
          }),
          { status: 200 }
        )
      }) as never
    })
    expect(await client.readTimeline('123', 100)).toEqual([
      {
        id: '9',
        text: 'hi',
        createdAt: '2026-09-29T10:00:00.000Z',
        impressions: 120,
        likes: 4,
        reposts: 1,
        replies: 2,
        quotes: 0,
        bookmarks: 3
      }
    ])
    const url = new URL(calls[0]!)
    expect(url.pathname).toBe('/2/users/123/tweets')
    expect(url.searchParams.get('max_results')).toBe('100')
    expect(url.searchParams.get('exclude')).toBe('retweets')
  })
})
