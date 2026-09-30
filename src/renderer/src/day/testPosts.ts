import type { Post } from '@shared/api'
import { singlePart } from '../test/parts'

/** A post for tests, scheduled unless the fields say otherwise. */
export function makePost(fields: Partial<Post> & Pick<Post, 'id'>): Post {
  const post: Omit<Post, 'parts'> & { parts?: Post['parts'] } = {
    accountId: null,
    nextAttemptAt: null,
    createdBy: 'user',
    autopilot: false,
    replyTo: null,
    text: `post ${fields.id}`,
    scheduledAt: '2026-09-28T09:00:00.000Z',
    status: 'scheduled',
    postedAt: null,
    remoteId: null,
    remoteUrl: null,
    error: null,
    errorCode: null,
    createdAt: '2026-09-26T10:00:00.000Z',
    updatedAt: '2026-09-26T10:00:00.000Z',
    ...fields
  }
  return { ...post, parts: post.parts ?? singlePart(post) }
}
