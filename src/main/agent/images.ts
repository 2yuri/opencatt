import type { ChatMessage, PostMedia } from '@shared/api'

/** Anthropic's size for images: larger ones are scaled down anyway and cost the same. */
export const MAX_IMAGE_SIDE = 1568
/** Images sent with a fresh CLI session's transcript, newest first; older ones stay as ids. */
export const MAX_TRANSCRIPT_IMAGES = 8
/**
 * Images the API path resends from the history, newest messages first. Anthropic refuses more
 * than 100 per request and 32 MB in all; older messages keep only their attachment note.
 */
export const MAX_HISTORY_IMAGES = 20

export interface ModelImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** Base64. */
  data: string
}

/**
 * An attached image as the model sees it, scaled to MAX_IMAGE_SIDE. Null for videos and GIFs,
 * which the model knows only by their note, and for everything when the user turned it off.
 */
export type ImageLoader = (media: PostMedia) => ModelImage | null

export const noImages: ImageLoader = () => null

/**
 * The user messages whose images still go to the model: the newest ones, until their images
 * would pass `max`. A message's images go all together or not at all.
 */
export function messagesWithImages(history: ChatMessage[], max: number): Set<string> {
  const keep = new Set<string>()
  let count = 0
  for (const message of [...history].reverse()) {
    if (message.role !== 'user') continue
    const images = message.media.filter((m) => m.kind === 'image').length
    if (images === 0) continue
    if (count + images > max) break
    count += images
    keep.add(message.id)
  }
  return keep
}

/** The images a user message carries, in order, skipping any that can't be loaded. */
export function imagesOf(message: ChatMessage, load: ImageLoader): ModelImage[] {
  return message.media.flatMap((m) => (m.kind === 'image' ? (load(m) ?? []) : []))
}
