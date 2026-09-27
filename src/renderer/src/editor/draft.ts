import type { NewPostPart, Post, PostMedia } from '@shared/api'
import { measureText } from './postText'

// The same limits PostsService enforces, checked here so the user sees them before saving.
export const MAX_PARTS = 25
export const MAX_IMAGES = 4

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

/** Why this set of media can't go on one post, or null when X accepts it. */
export function mediaProblem(media: Pick<PostMedia, 'kind'>[]): string | null {
  const images = media.filter((m) => m.kind === 'image').length
  if (media.length > 1 && media.some((m) => m.kind !== 'image')) {
    return 'A GIF or video has to be the only media in its post.'
  }
  if (images > MAX_IMAGES) return `X allows up to ${MAX_IMAGES} images per post.`
  return null
}

/** The first problem in a part, worded for the thread or the single post. */
export function partProblem(part: DraftPart, index: number, count: number): string | null {
  const where = count > 1 ? `Post ${index + 1} of the thread` : 'The post'
  const measure = measureText(part.text)
  if (measure.empty && part.media.length === 0) {
    return count > 1 ? `${where} needs text or media.` : 'Write something first.'
  }
  if (measure.over) return `${where} is ${-measure.remaining} over the 280 limit.`
  const media = mediaProblem(part.media)
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
