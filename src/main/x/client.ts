import { open, readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { MediaKind, Post, PostMedia } from '@shared/api'
import { AuthError } from '@shared/authErrors'
import { oauth1Header } from '../auth/oauth1'
import { ReconnectNeededError, type XCredentials } from '../auth/service'
import { X_API, type Fetch } from '../auth/xOAuth'

/**
 * How the publisher (OP-10) should treat a failure:
 * retryable: X was down, slow or rate limited; try again later (after `resetAt` for a 429).
 * auth: the account must sign in again; fail the post with error_code auth.
 * rejected: X refused this post (duplicate text, too long, bad media); fail it with rejected.
 * uncertain: a post was sent and X's answer was lost (timeout, dropped connection, 5xx), so it
 *   may be on X already; fail it with uncertain and never resend it on its own.
 * processing: X is still processing one of its videos; nothing was posted. Come back at
 *   `resetAt` without counting it as a retry, and send other due posts meanwhile (OP-70).
 */
export type XErrorKind = 'retryable' | 'auth' | 'rejected' | 'uncertain' | 'processing'

export class XError extends Error {
  constructor(
    readonly kind: XErrorKind,
    message: string,
    readonly status: number | null = null,
    /** For a 429: when X lets this account post again. */
    readonly resetAt: Date | null = null
  ) {
    super(message)
    this.name = 'XError'
  }
}

export interface XAccountAuth {
  credentialsFor(accountId: string): Promise<XCredentials>
  forceRefresh(accountId: string): Promise<XCredentials>
}

/** One of the account's own posts as the timeline returns it, with its public stats (OP-109). */
export interface TimelinePost {
  id: string
  text: string
  createdAt: string
  impressions: number
  likes: number
  reposts: number
  replies: number
  quotes: number
  bookmarks: number
}

/** A post that mentions the account, as X's mentions timeline returns it (OP-124). */
export interface Mention {
  id: string
  text: string
  createdAt: string
  /** The thread's first post. */
  conversationId: string
  /** The post it replies to, when it is a reply. */
  inReplyTo: string | null
  author: { id: string; handle: string; name: string | null }
}

export interface PublishedPart {
  remoteId: string
  remoteUrl: string
}

export interface XClientDeps {
  auth: XAccountAuth
  /** Absolute path of an imported media file (MediaStore.pathOf). */
  mediaPath: (mediaId: string) => string
  fetch?: Fetch
  /** X's media ids for videos uploaded earlier, so a due post doesn't upload or wait (OP-70). */
  videos?: VideoCache
  now?: () => Date
}

/** Where XClient keeps the X media ids of uploaded videos; the app's is XMediaStore. */
export interface VideoCache {
  get(
    mediaId: string,
    accountId: string
  ): { xMediaId: string; uploadedAt: Date; ready: boolean } | null
  save(
    mediaId: string,
    accountId: string,
    media: { xMediaId: string; uploadedAt: Date; ready: boolean }
  ): void
  forget(mediaId: string, accountId: string): void
}

/** How long a failed early upload waits before prepare() tries it again. */
export const PREPARE_RETRY_MS = 5 * 60 * 1000

/** X keeps an uploaded media id for 24 hours; one older than this is uploaded again. */
export const VIDEO_REUSE_MS = 20 * 60 * 60 * 1000

/** X's limits for video (OP-18): 512 MB, 2 min 20 s. The import step already enforces them. */
const VIDEO_MAX_BYTES = 512 * 1024 * 1024
const VIDEO_MAX_MS = 140_000
/** X takes at most 5 MB per append; 4 MB leaves room for the multipart overhead. */
export const VIDEO_CHUNK_BYTES = 4 * 1024 * 1024
/** How long a video may stay in X's processing before the post is retried later. */
const PROCESSING_LIMIT_MS = 10 * 60 * 1000

/** What X takes through simple upload; video (chunked, with processing) is OP-18. */
const UPLOAD_LIMITS: Record<Exclude<MediaKind, 'video'>, { bytes: number; category: string }> = {
  image: { bytes: 5 * 1024 * 1024, category: 'tweet_image' },
  gif: { bytes: 15 * 1024 * 1024, category: 'tweet_gif' }
}

/** X answers in well under a second; an upload of a few MB gets longer. */
const REQUEST_TIMEOUT_MS = 60_000

/** The error text for a post whose fate is unknown; the card offers Check on X. */
const LOST_ANSWER =
  "X didn't answer after the post was sent, so it may be on X already. Check your profile before posting again."

/** A link to a post that works without knowing the account's handle. */
export const postUrl = (id: string): string => `https://x.com/i/web/status/${id}`

type Body = { json: unknown } | { form: FormData } | undefined

function memoryVideoCache(): VideoCache {
  const known = new Map<string, { xMediaId: string; uploadedAt: Date; ready: boolean }>()
  return {
    get: (mediaId, accountId) => known.get(`${mediaId} ${accountId}`) ?? null,
    save: (mediaId, accountId, media) => void known.set(`${mediaId} ${accountId}`, media),
    forget: (mediaId, accountId) => void known.delete(`${mediaId} ${accountId}`)
  }
}

interface Processing {
  state: 'pending' | 'in_progress' | 'succeeded' | 'failed'
  check_after_secs?: number
  error?: { name?: string; message?: string }
}

/**
 * Publishes posts to X as the account they belong to, with that account's OAuth 2.0 token or
 * OAuth 1.0a keys (OP-5). It never touches the database: the publisher (OP-10) records each part
 * through `onPartPosted` and decides what a failure means from XError.kind.
 */
export class XClient {
  private readonly fetch: Fetch
  private readonly now: () => Date
  /** Kept in memory when the app gives no store (tests). */
  private readonly videos: VideoCache
  /** When a failed early upload may be tried again, per media and account. */
  private readonly preparedFailed = new Map<string, number>()

  constructor(private readonly deps: XClientDeps) {
    this.fetch = deps.fetch ?? fetch
    this.now = deps.now ?? (() => new Date())
    this.videos = deps.videos ?? memoryVideoCache()
  }

  /**
   * Uploads the videos of a post that is due soon, so that when it is due it neither uploads nor
   * waits on X processing them. Anything that goes wrong is left for publish() to report.
   */
  async prepare(post: Post): Promise<void> {
    const accountId = post.accountId
    if (!accountId) return
    for (const media of post.parts.filter((p) => !p.remoteId).flatMap((p) => p.media)) {
      if (media.kind !== 'video' || this.freshVideo(media.id, accountId)) continue
      const key = `${media.id} ${accountId}`
      // A video X just refused isn't sent again on every 30-second pass.
      if ((this.preparedFailed.get(key) ?? 0) > this.now().getTime()) continue
      try {
        await this.startVideo(accountId, media.id, await this.check(media))
        this.preparedFailed.delete(key)
      } catch {
        // publish() checks and uploads again when the post is due, and says what's wrong then.
        this.preparedFailed.set(key, this.now().getTime() + PREPARE_RETRY_MS)
      }
    }
  }

  private freshVideo(mediaId: string, accountId: string) {
    const known = this.videos.get(mediaId, accountId)
    if (!known || this.now().getTime() - known.uploadedAt.getTime() > VIDEO_REUSE_MS) return null
    return known
  }

  /**
   * Posts every part that isn't on X yet, each as a reply to the one before, and returns the
   * first part's id and URL. `onPartPosted` runs after each part, so a failure halfway through a
   * thread resumes from the first part without a remoteId.
   */
  async publish(
    post: Post,
    onPartPosted: (partId: string, remote: PublishedPart) => void
  ): Promise<PublishedPart> {
    const accountId = post.accountId
    if (!accountId) throw new XError('auth', 'Connect an X account to post this.')
    if (post.parts.length === 0) throw new Error(`Post ${post.id} has no parts`)
    const unposted = post.parts.filter((part) => !part.remoteId)

    // Every part's media is checked, then uploaded, before the first part goes out, so bad media
    // in part 3 can't leave parts 1 and 2 on X. X keeps uploaded media ids for 24 hours.
    const files = new Map<string, string>()
    for (const media of unposted.flatMap((part) => part.media)) {
      files.set(media.id, await this.check(media))
    }
    const mediaIds = new Map<string, string[]>()
    for (const part of unposted) {
      const ids: string[] = []
      for (const media of part.media)
        ids.push(await this.upload(accountId, media, files.get(media.id)!))
      mediaIds.set(part.id, ids)
    }

    // A reply to a comment (OP-124) starts under it; each part after replies to the one before.
    let previous: string | null = post.replyTo
    let head: PublishedPart | null = null
    for (const part of post.parts) {
      if (part.remoteId) {
        previous = part.remoteId
        head ??= { remoteId: part.remoteId, remoteUrl: part.remoteUrl ?? postUrl(part.remoteId) }
        continue
      }
      const body: Record<string, unknown> = { text: part.text }
      const ids = mediaIds.get(part.id)!
      if (ids.length > 0) body['media'] = { media_ids: ids }
      if (previous) body['reply'] = { in_reply_to_tweet_id: previous }
      const res = await this.request(accountId, 'POST', `${X_API}/2/tweets`, { json: body }, true)
      const id = await res
        .json()
        .then((json) => (json as { data?: { id?: string } }).data?.id)
        .catch(() => undefined)
      if (!id) throw new XError('uncertain', LOST_ANSWER, res.status)
      const remote = { remoteId: id, remoteUrl: postUrl(id) }
      onPartPosted(part.id, remote)
      previous = id
      head ??= remote
    }
    if (!head) throw new Error(`Post ${post.id} has no parts`)
    return head
  }

  /**
   * The account's latest posts with their stats, one page of up to `max` (OP-109). Reading your
   * own timeline is X's "owned reads", its cheapest read. Reposts are left out: they are other
   * people's posts, and each one returned would still be charged.
   */
  async readTimeline(accountId: string, max = 100): Promise<TimelinePost[]> {
    const params = new URLSearchParams({
      max_results: String(Math.min(100, Math.max(5, max))),
      exclude: 'retweets',
      'tweet.fields': 'public_metrics,created_at'
    })
    const url = `${X_API}/2/users/${encodeURIComponent(accountId)}/tweets?${params}`
    const res = await this.request(accountId, 'GET', url, undefined)
    const json = (await res.json().catch(() => null)) as {
      data?: {
        id?: string
        text?: string
        created_at?: string
        public_metrics?: Record<string, number | undefined>
      }[]
    } | null
    const n = (value: number | undefined): number => (typeof value === 'number' ? value : 0)
    return (json?.data ?? []).flatMap((post) => {
      if (!post.id) return []
      const m = post.public_metrics ?? {}
      return [
        {
          id: post.id,
          text: post.text ?? '',
          createdAt: post.created_at ?? this.now().toISOString(),
          impressions: n(m['impression_count']),
          likes: n(m['like_count']),
          reposts: n(m['retweet_count']),
          replies: n(m['reply_count']),
          quotes: n(m['quote_count']),
          bookmarks: n(m['bookmark_count'])
        }
      ]
    })
  }

  /**
   * The account's latest mentions (OP-124), up to 100, or only those newer than `sinceId` (and
   * older than `untilId`, to fill a gap), with
   * the thread each one is in and its author. Mentions are owned reads, charged per post
   * returned; `users` counts the authors X sent along, in case it charges for those too.
   */
  async readMentions(
    accountId: string,
    sinceId: string | null = null,
    untilId: string | null = null
  ): Promise<{ mentions: Mention[]; users: number; more: boolean }> {
    const params = new URLSearchParams({
      max_results: '100',
      'tweet.fields': 'conversation_id,in_reply_to_user_id,referenced_tweets,author_id,created_at',
      expansions: 'author_id',
      'user.fields': 'username,name'
    })
    if (sinceId) params.set('since_id', sinceId)
    if (untilId) params.set('until_id', untilId)
    const url = `${X_API}/2/users/${encodeURIComponent(accountId)}/mentions?${params}`
    const res = await this.request(accountId, 'GET', url, undefined)
    const json = (await res.json().catch(() => null)) as {
      data?: {
        id?: string
        text?: string
        created_at?: string
        author_id?: string
        conversation_id?: string
        referenced_tweets?: { type?: string; id?: string }[]
      }[]
      includes?: { users?: { id?: string; username?: string; name?: string }[] }
      meta?: { next_token?: string }
    } | null
    const users = new Map(
      (json?.includes?.users ?? []).flatMap((u) => (u.id ? [[u.id, u] as const] : []))
    )
    const mentions = (json?.data ?? []).flatMap((m): Mention[] => {
      if (!m.id || !m.author_id || !m.conversation_id) return []
      const author = users.get(m.author_id)
      return [
        {
          id: m.id,
          text: m.text ?? '',
          createdAt: m.created_at ?? this.now().toISOString(),
          conversationId: m.conversation_id,
          inReplyTo: m.referenced_tweets?.find((r) => r.type === 'replied_to')?.id ?? null,
          author: {
            id: m.author_id,
            handle: author?.username ?? m.author_id,
            name: author?.name ?? null
          }
        }
      ]
    })
    // X has older ones in the same range: another page, which the caller reads on a later refresh.
    return { mentions, users: users.size, more: typeof json?.meta?.next_token === 'string' }
  }

  /** What X would refuse, before anything is uploaded; returns the file's path. */
  private async check(media: PostMedia): Promise<string> {
    const path = this.deps.mediaPath(media.id)
    const size = await stat(path).then(
      (s) => s.size,
      () => null
    )
    if (size === null) throw new XError('rejected', 'An attached file is missing. Attach it again.')
    if (media.kind === 'video') {
      if (size > VIDEO_MAX_BYTES) throw new XError('rejected', 'X takes videos up to 512 MB.')
      if (media.durationMs !== null && media.durationMs > VIDEO_MAX_MS) {
        throw new XError('rejected', 'X takes videos up to 2 minutes 20 seconds.')
      }
      return path
    }
    const limit = UPLOAD_LIMITS[media.kind]
    if (size > limit.bytes) {
      throw new XError(
        'rejected',
        `X takes ${media.kind === 'gif' ? 'GIFs' : 'images'} up to ${limit.bytes / 1024 / 1024} MB.`
      )
    }
    return path
  }

  /** Uploads one checked image, GIF or video and sets its alt text; returns X's media id. */
  private async upload(accountId: string, media: PostMedia, path: string): Promise<string> {
    const id =
      media.kind === 'video'
        ? await this.readyVideo(accountId, media.id, path)
        : await this.uploadImage(accountId, media, path)
    if (media.alt) {
      await this.request(accountId, 'POST', `${X_API}/2/media/metadata`, {
        json: { id, metadata: { alt_text: { text: media.alt.slice(0, 1000) } } }
      })
    }
    return id
  }

  private async uploadImage(accountId: string, media: PostMedia, path: string): Promise<string> {
    const limit = UPLOAD_LIMITS[media.kind as 'image' | 'gif']
    const form = new FormData()
    form.append('media_category', limit.category)
    form.append('media', new Blob([await readFile(path)], { type: media.mime }), basename(path))
    const res = await this.request(accountId, 'POST', `${X_API}/2/media/upload`, { form })
    const { data } = (await res.json()) as { data: { id: string } }
    return data.id
  }

  /**
   * X's media id for a video that X has finished processing: uploaded earlier by prepare() or
   * now. While X is still processing it, throws XError 'processing' with the time to look again,
   * so the publisher sends other posts meanwhile instead of waiting (OP-70).
   */
  private async readyVideo(accountId: string, mediaId: string, path: string): Promise<string> {
    const known =
      this.freshVideo(mediaId, accountId) ?? (await this.startVideo(accountId, mediaId, path))
    if (known.ready) return known.xMediaId
    const processing = await this.videoStatus(accountId, known.xMediaId)
    if (!processing || processing.state === 'succeeded') {
      this.videos.save(mediaId, accountId, { ...known, ready: true })
      return known.xMediaId
    }
    if (processing.state === 'failed') {
      this.videos.forget(mediaId, accountId)
      const said = processing.error?.message ?? processing.error?.name ?? 'it could not process it'
      throw new XError('rejected', `X couldn't use this video: ${said}`)
    }
    if (this.now().getTime() - known.uploadedAt.getTime() >= PROCESSING_LIMIT_MS) {
      // Start over with a fresh upload next time.
      this.videos.forget(mediaId, accountId)
      throw new XError('retryable', 'X is still processing the video. OpenCatt will try again.')
    }
    const wait = Math.max(1, processing.check_after_secs ?? 5) * 1000
    throw new XError(
      'processing',
      'X is still processing the video.',
      null,
      new Date(this.now().getTime() + wait)
    )
  }

  /** X's chunked upload (OP-18): initialize, append in 4 MB pieces, finalize. Remembers the id. */
  private async startVideo(
    accountId: string,
    mediaId: string,
    path: string
  ): Promise<{ xMediaId: string; uploadedAt: Date; ready: boolean }> {
    const { size } = await stat(path)
    const init = await this.request(accountId, 'POST', `${X_API}/2/media/upload/initialize`, {
      json: { media_type: 'video/mp4', total_bytes: size, media_category: 'tweet_video' }
    })
    const { data } = (await init.json()) as { data: { id: string } }
    const id = data.id

    const file = await open(path, 'r')
    try {
      const chunk = Buffer.alloc(Math.min(VIDEO_CHUNK_BYTES, size))
      for (let index = 0, offset = 0; offset < size; index++) {
        const { bytesRead } = await file.read(chunk, 0, chunk.length, offset)
        const form = new FormData()
        form.append('segment_index', String(index))
        form.append('media', new Blob([chunk.subarray(0, bytesRead)]), 'chunk')
        await this.request(accountId, 'POST', `${X_API}/2/media/upload/${id}/append`, { form })
        offset += bytesRead
      }
    } finally {
      await file.close()
    }

    const finalized = await this.request(
      accountId,
      'POST',
      `${X_API}/2/media/upload/${id}/finalize`,
      undefined
    )
    const processing = ((await finalized.json()) as { data?: { processing_info?: Processing } })
      .data?.processing_info
    if (processing?.state === 'failed') {
      const said = processing.error?.message ?? processing.error?.name ?? 'it could not process it'
      throw new XError('rejected', `X couldn't use this video: ${said}`)
    }
    const known = {
      xMediaId: id,
      uploadedAt: this.now(),
      ready: !processing || processing.state === 'succeeded'
    }
    this.videos.save(mediaId, accountId, known)
    return known
  }

  private async videoStatus(accountId: string, id: string): Promise<Processing | undefined> {
    const status = await this.request(
      accountId,
      'GET',
      `${X_API}/2/media/upload?command=STATUS&media_id=${id}`,
      undefined
    )
    return ((await status.json()) as { data?: { processing_info?: Processing } }).data
      ?.processing_info
  }

  /**
   * One authenticated call. A 401 on OAuth 2.0 gets one forced token refresh and a retry.
   * `createsPost` marks the call that puts a post on X: when its answer is lost or X answers
   * 5xx, the post may exist anyway, so the error is uncertain rather than retryable.
   */
  private async request(
    accountId: string,
    method: string,
    url: string,
    body: Body,
    createsPost = false
  ): Promise<Response> {
    let res = await this.send(
      await this.credentials(accountId, false),
      method,
      url,
      body,
      createsPost
    )
    if (res.status === 401) {
      const again = await this.credentials(accountId, true)
      if (again.mode === 'oauth2') res = await this.send(again, method, url, body, createsPost)
    }
    if (res.ok) return res
    const error = await errorFrom(res)
    if (createsPost && res.status >= 500) {
      throw new XError('uncertain', `${LOST_ANSWER} ${error.message}`, res.status)
    }
    throw error
  }

  private async credentials(accountId: string, force: boolean): Promise<XCredentials> {
    try {
      return await (force
        ? this.deps.auth.forceRefresh(accountId)
        : this.deps.auth.credentialsFor(accountId))
    } catch (err) {
      if (err instanceof ReconnectNeededError) throw new XError('auth', err.message)
      if (err instanceof AuthError) throw new XError('retryable', "Couldn't reach X.")
      throw err
    }
  }

  private async send(
    credentials: XCredentials,
    method: string,
    url: string,
    body: Body,
    createsPost: boolean
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization:
        credentials.mode === 'oauth2'
          ? `Bearer ${credentials.accessToken}`
          : // A JSON or multipart body isn't part of an OAuth 1.0a signature.
            oauth1Header(credentials.keys, { method, url })
    }
    let payload: string | FormData | undefined
    if (body && 'json' in body) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body.json)
    } else if (body) {
      payload = body.form
    }
    try {
      return await this.fetch(url, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch {
      throw createsPost
        ? new XError('uncertain', LOST_ANSWER)
        : new XError('retryable', "Couldn't reach X.")
    }
  }
}

/** X's answer as an XError, with X's own message kept for the post's error text. */
async function errorFrom(res: Response): Promise<XError> {
  const json = (await res.json().catch(() => null)) as {
    detail?: string
    title?: string
    errors?: { message?: string; detail?: string }[]
  } | null
  const said =
    json?.detail ??
    json?.errors?.[0]?.message ??
    json?.errors?.[0]?.detail ??
    json?.title ??
    `HTTP ${res.status}`
  const message = `X said: ${said}`
  if (res.status === 429) {
    const reset = Number(res.headers.get('x-rate-limit-reset'))
    return new XError(
      'retryable',
      message,
      429,
      Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000) : null
    )
  }
  if (res.status === 401) return new XError('auth', message, 401)
  if (res.status >= 500 || res.status === 408) return new XError('retryable', message, res.status)
  // 400 and 403: X read the post and refused it (duplicate text, no write access, bad media).
  return new XError('rejected', message, res.status)
}
