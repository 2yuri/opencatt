import type { Post } from '@shared/api'

export interface DayColumns {
  /** Written by the agent or an MCP client, waiting for the user's approval. */
  pending: Post[]
  /** Turned down by the user: kept, read-only, until deleted. */
  rejected: Post[]
  scheduled: Post[]
  posted: Post[]
}

/**
 * Pending holds what waits for approval, by time, and rejected what the user turned down.
 * Scheduled holds the rest not yet on X:
 * scheduled, posting and failed, by time. Posted holds what went out, in the order it went out.
 */
export function splitColumns(posts: Post[]): DayColumns {
  const byTime = (a: Post, b: Post): number => a.scheduledAt.localeCompare(b.scheduledAt)
  const pending = posts.filter((post) => post.status === 'pending_approval').sort(byTime)
  const rejected = posts.filter((post) => post.status === 'rejected').sort(byTime)
  const scheduled = posts
    .filter((post) => !['posted', 'pending_approval', 'rejected'].includes(post.status))
    .sort(byTime)
  const posted = posts
    .filter((post) => post.status === 'posted')
    .sort((a, b) => (a.postedAt ?? a.scheduledAt).localeCompare(b.postedAt ?? b.scheduledAt))
  return { pending, rejected, scheduled, posted }
}

/** Where a posted post lives on X. */
export function postUrl(post: Post): string | null {
  if (post.remoteUrl) return post.remoteUrl
  return post.remoteId ? `https://x.com/i/status/${post.remoteId}` : null
}

/** OP-30's approve refuses a post more than this late; it has to get a new time first. */
export const LATE_AFTER_MS = 60 * 60 * 1000

export const isLate = (post: Post, now: Date = new Date()): boolean =>
  new Date(post.scheduledAt).getTime() < now.getTime() - LATE_AFTER_MS
