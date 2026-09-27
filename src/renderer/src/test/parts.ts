import type { Post, PostPart } from '@shared/api'

/** The parts of a single text post, for test fixtures that only care about `text`. */
export function singlePart(
  post: Pick<Post, 'id' | 'text' | 'remoteId' | 'remoteUrl' | 'postedAt'>
): PostPart[] {
  return [
    {
      id: `${post.id}-part-0`,
      position: 0,
      text: post.text,
      media: [],
      remoteId: post.remoteId,
      remoteUrl: post.remoteUrl,
      postedAt: post.postedAt
    }
  ]
}
