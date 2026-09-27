import type { Post } from '@shared/api'
import { toLocalDate } from '../calendar/grid'

/**
 * Where a post opens from the chat. Since OP-39 posts that wait for approval, or were turned
 * down, live on the Approvals page rather than the day board; `post` lets that page scroll to
 * and highlight the one that was clicked (OP-40).
 */
export function postRoute(post: Pick<Post, 'id' | 'status' | 'scheduledAt'>): string {
  const id = encodeURIComponent(post.id)
  if (post.status === 'pending_approval') return `/approvals?post=${id}`
  if (post.status === 'rejected') return `/approvals?tab=rejected&post=${id}`
  return `/day/${toLocalDate(new Date(post.scheduledAt))}`
}
