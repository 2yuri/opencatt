import { format } from 'date-fns'
import { MISSED_AFTER_MS, type Post, type XAccount } from '@shared/api'
import type { PostsService } from './db/posts'
import { XError, type PublishedPart } from './x/client'

/** Waits before each retry of a post X couldn't take right now: 1, 5, then 15 minutes. */
export const RETRY_DELAYS_MS = [1, 5, 15].map((min) => min * 60 * 1000)

/** The longest the publisher sleeps: a clock change or a missed wake-up costs at most this. */
export const CHECK_EVERY_MS = 30 * 1000

/** How far ahead a post's videos are uploaded, so X has processed them by its time (OP-70). */
export const PREPARE_AHEAD_MS = 30 * 60 * 1000

export const UNCERTAIN_ERROR =
  'The app closed while posting. Check your X profile before posting again.'
export const MISSED_ERROR =
  'It was due more than an hour ago, while OpenCatt was closed or the computer was asleep.'

export interface PublisherDeps {
  posts: PostsService
  publish: (
    post: Post,
    onPartPosted: (partId: string, remote: PublishedPart) => void
  ) => Promise<PublishedPart>
  account: (accountId: string) => XAccount | null
  /** Uploads a soon-due post's videos ahead of time (OP-70); XClient.prepare in the app. */
  prepare?: (post: Post) => Promise<void>
  now?: () => Date
  setTimer?: (run: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
  /** Tells the user once per account that it has to sign in again. */
  onSignedOut?: (account: XAccount | null) => void
}

/**
 * Sends scheduled posts when they are due (OP-10), one at a time, as each post's own account.
 * It is the only thing that moves a post out of scheduled: posting → posted, a retry later, or
 * failed with an error_code the card turns into buttons.
 */
export class Publisher {
  private readonly now: () => Date
  private readonly setTimer: (run: () => void, ms: number) => unknown
  private readonly clearTimer: (timer: unknown) => void
  private timer: unknown = null
  private running: Promise<void> | null = null
  private preparing: Promise<void> | null = null
  private again = false
  private stopped = true
  /** Retries so far per post, since the app started. */
  private readonly attempts = new Map<string, number>()
  private readonly toldSignedOut = new Set<string>()

  constructor(private readonly deps: PublisherDeps) {
    this.now = deps.now ?? (() => new Date())
    this.setTimer = deps.setTimer ?? ((run, ms) => setTimeout(run, ms))
    this.clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout))
  }

  /** Recovers what the last run left behind, then sends whatever is due and keeps watching. */
  start(): Promise<void> {
    this.stopped = false
    this.recover()
    return this.poke()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
  }

  /**
   * A post in posting at startup may or may not be on X. It is never resent on its own: a
   * duplicate is worse than a missing post.
   */
  private recover(): void {
    for (const post of this.deps.posts.listPosting()) {
      this.deps.posts.markFailed(post.id, 'uncertain', UNCERTAIN_ERROR)
    }
  }

  /** Runs now, or right after the run in progress: after posts change, or the computer wakes. */
  poke(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          await this.runOnce()
        } while (this.again && !this.stopped)
      } finally {
        this.running = null
        this.schedule()
      }
    })()
    return this.running
  }

  private schedule(): void {
    if (this.stopped) return
    if (this.timer !== null) this.clearTimer(this.timer)
    const next = this.deps.posts.nextDueAt()
    const wait = next ? Math.max(0, next.getTime() - this.now().getTime()) : CHECK_EVERY_MS
    this.timer = this.setTimer(
      () => {
        this.timer = null
        void this.poke()
      },
      Math.min(wait, CHECK_EVERY_MS)
    )
  }

  private async runOnce(): Promise<void> {
    for (const post of this.deps.posts.listDue(this.now())) {
      if (this.stopped) return
      // One post that can't even be marked failed (edited or deleted meanwhile) must not stop
      // the rest of the pass.
      try {
        await this.send(post)
      } catch (err) {
        console.error(`Publisher: post ${post.id} could not be settled:`, err)
      }
    }
    this.prepareSoon()
  }

  /**
   * Uploads the videos of posts due soon beside the send loop, one run at a time, so a slow
   * upload never holds up a post that becomes due meanwhile. Uploading posts nothing.
   */
  private prepareSoon(): void {
    const prepare = this.deps.prepare
    if (!prepare || this.preparing) return
    const soon = new Date(this.now().getTime() + PREPARE_AHEAD_MS)
    const posts = this.deps.posts
      .listDue(soon)
      .filter((post) =>
        post.parts.some((p) => !p.remoteId && p.media.some((m) => m.kind === 'video'))
      )
    if (posts.length === 0) return
    this.preparing = (async () => {
      for (const post of posts) {
        if (this.stopped) return
        await prepare(post).catch(() => {})
      }
    })().finally(() => {
      this.preparing = null
    })
  }

  private async send(post: Post): Promise<void> {
    const { posts } = this.deps
    // Late from when it was last meant to go: a retry X asked us to hold (a rate-limit reset)
    // isn't missed, but a retry the app slept through by more than an hour is.
    const late = this.now().getTime() - Date.parse(post.nextAttemptAt ?? post.scheduledAt)
    if (late > MISSED_AFTER_MS) {
      posts.markFailed(post.id, 'missed', MISSED_ERROR)
      return
    }
    // False when it was edited, deleted or claimed since listDue: leave it alone.
    if (!posts.markPosting(post.id)) return
    const claimed = posts.get(post.id)!
    try {
      await this.deps.publish(claimed, (partId, remote) => posts.markPartPosted(partId, remote))
      posts.markPosted(post.id)
      this.attempts.delete(post.id)
    } catch (err) {
      this.failed(claimed, err)
    }
  }

  private failed(post: Post, err: unknown): void {
    const { posts } = this.deps
    // Anything that isn't X's own answer (a crash while recording a part, say) may have come after
    // the post went out, so it is treated like a lost answer: never resent on its own.
    const error =
      err instanceof XError
        ? err
        : new XError(
            'uncertain',
            `Something went wrong while posting, so it may be on X already. Check your profile before posting again. (${String(err)})`
          )
    if (error.kind === 'auth') {
      this.attempts.delete(post.id)
      // No account at all (none connected yet): nothing was signed out, so the client's own
      // "Connect an X account to post this." stands and there's no sign-out notice.
      if (!post.accountId) {
        posts.markFailed(post.id, 'auth', error.message)
        return
      }
      const account = this.deps.account(post.accountId)
      const message = account
        ? `X signed out @${account.handle}. Reconnect @${account.handle} to post this.`
        : 'X signed out the account this post belongs to. Reconnect it to post this.'
      posts.markFailed(post.id, 'auth', message)
      if (!this.toldSignedOut.has(post.accountId)) {
        this.toldSignedOut.add(post.accountId)
        this.deps.onSignedOut?.(account)
      }
      return
    }
    if (error.kind === 'processing') {
      // Nothing was sent: look again when X says to, and send other due posts meanwhile. X's own
      // 10-minute limit turns a stuck video into a normal retry (XClient).
      posts.markRetry(post.id, error.resetAt ?? new Date(this.now().getTime() + 5000))
      return
    }
    if (error.kind === 'uncertain') {
      // It may be on X already: never resent on its own, the card offers Check on X.
      posts.markFailed(post.id, 'uncertain', error.message)
      this.attempts.delete(post.id)
      return
    }
    if (error.kind === 'rejected') {
      posts.markFailed(post.id, 'rejected', error.message)
      this.attempts.delete(post.id)
      return
    }
    const attempt = this.attempts.get(post.id) ?? 0
    if (attempt >= RETRY_DELAYS_MS.length) {
      posts.markFailed(post.id, 'retries_exhausted', error.message)
      this.attempts.delete(post.id)
      return
    }
    // A rate limit that lifts more than an hour after the post's time (X's daily cap can be ~24 h
    // away) would send it far too late without anyone deciding to: fail it now and let the user
    // pick a new time.
    const limit = Date.parse(post.scheduledAt) + MISSED_AFTER_MS
    if (error.resetAt && error.resetAt.getTime() > limit) {
      posts.markFailed(
        post.id,
        'retries_exhausted',
        `X's rate limit for this account lifts at ${format(error.resetAt, 'HH:mm')}, more than an hour after this post's time. Pick a new time for it.`
      )
      this.attempts.delete(post.id)
      return
    }
    this.attempts.set(post.id, attempt + 1)
    const backoff = this.now().getTime() + RETRY_DELAYS_MS[attempt]!
    const at = Math.max(backoff, error.resetAt?.getTime() ?? 0)
    posts.markRetry(post.id, new Date(at))
  }

  /** The account can post again, so the next sign-out is worth telling the user about. */
  signedIn(accountId: string): void {
    this.toldSignedOut.delete(accountId)
  }
}
