import type { NewPostPart, Post, PostMedia } from '@shared/api'
import {
  PLATFORM_RULES,
  mediaProblem as platformMediaProblem,
  type PlatformRules
} from '@shared/platforms'
import { measureText } from './postText'

// The same limits PostsService enforces (src/shared/platforms.ts), checked here so the user sees
// them before saving.
export const MAX_PARTS = PLATFORM_RULES.x.maxParts
export const MAX_IMAGES = PLATFORM_RULES.x.maxImages

/** One part of the post while it's being edited. */
export interface DraftPart {
  /** Stable React key, also for parts not saved yet. */
  key: string
  text: string
  media: PostMedia[]
  /** Already on X (a thread that failed halfway): shown, never changed. */
  locked: boolean
  remoteUrl: string | null
}

let nextKey = 0
const newKey = (): string => `draft-${++nextKey}`

export function emptyPart(): DraftPart {
  return { key: newKey(), text: '', media: [], locked: false, remoteUrl: null }
}

export function draftFromPost(post: Post | null, seed: PostMedia[] = []): DraftPart[] {
  if (!post) return [{ ...emptyPart(), media: seed }]
  return post.parts.map((part) => ({
    key: part.id,
    text: part.text,
    media: part.media,
    locked: part.remoteId !== null,
    remoteUrl: part.remoteUrl
  }))
}

export function toPayload(parts: DraftPart[]): NewPostPart[] {
  return parts.map((part) => ({
    text: part.text,
    media: part.media.map((m) => ({ id: m.id, alt: m.alt?.trim() ? m.alt.trim() : null }))
  }))
}

/**
 * Why this set of media can't go on one post, or null when the platform accepts it. An empty set
 * passes here: a post with no media at all is partProblem's to judge, with the text.
 */
export function mediaProblem(
  media: Pick<PostMedia, 'kind'>[],
  rules: PlatformRules = PLATFORM_RULES.x
): string | null {
  if (media.length === 0) return null
  const problem = platformMediaProblem(
    rules,
    media.map((m) => m.kind)
  )
  return problem ? `${problem[0].toUpperCase()}${problem.slice(1)}.` : null
}

/** The first problem in a part, worded for the thread or the single post. */
export function partProblem(
  part: DraftPart,
  index: number,
  count: number,
  rules: PlatformRules = PLATFORM_RULES.x
): string | null {
  const where = count > 1 ? `Post ${index + 1} of the thread` : 'The post'
  const measure = measureText(part.text, rules)
  if (rules.videoRequired && !part.media.some((m) => m.kind === 'video')) {
    return `A ${rules.name} post needs a video.`
  }
  if (measure.empty && part.media.length === 0) {
    return count > 1 ? `${where} needs text or media.` : 'Write something first.'
  }
  if (measure.over) return `${where} is ${-measure.remaining} over the ${measure.max} limit.`
  const media = mediaProblem(part.media, rules)
  return media ? `${where}: ${media}` : null
}

/** Parts already on X always come first, so nothing may move above them. */
export function firstEditable(parts: DraftPart[]): number {
  const index = parts.findIndex((part) => !part.locked)
  return index === -1 ? parts.length : index
}

export function movePart(parts: DraftPart[], index: number, step: -1 | 1): DraftPart[] {
  const to = index + step
  if (to < firstEditable(parts) || to >= parts.length || parts[index].locked) return parts
  const next = [...parts]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}
