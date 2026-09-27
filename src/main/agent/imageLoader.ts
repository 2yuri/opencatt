import { readFileSync } from 'node:fs'
import { nativeImage } from 'electron'
import type { PostMedia } from '@shared/api'
import { MAX_IMAGE_SIDE, type ImageLoader, type ModelImage } from './images'

const SENDABLE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
/** Anthropic refuses images over 5 MB. */
const MAX_BYTES = 5 * 1024 * 1024

/**
 * Loads attached images for the model, scaled with Electron's nativeImage. Media files never
 * change once imported, so each is scaled once and kept for the rest of the run.
 */
export function electronImageLoader(
  pathOf: (id: string) => string,
  enabled: () => boolean
): ImageLoader {
  const cache = new Map<string, ModelImage | null>()
  return (media: PostMedia) => {
    if (!enabled() || media.kind !== 'image') return null
    if (!cache.has(media.id)) cache.set(media.id, load(pathOf(media.id), media.mime))
    return cache.get(media.id) ?? null
  }
}

function load(path: string, mime: string): ModelImage | null {
  try {
    const image = nativeImage.createFromPath(path)
    const { width, height } = image.getSize()
    if (width > 0 && (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE)) {
      const scale = MAX_IMAGE_SIDE / Math.max(width, height)
      const small = image.resize({
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        quality: 'good'
      })
      return { mediaType: 'image/jpeg', data: small.toJPEG(85).toString('base64') }
    }
    // Small enough already, or a format nativeImage can't decode (WEBP on some systems).
    if (!SENDABLE.has(mime)) return null
    const bytes = readFileSync(path)
    if (bytes.length > MAX_BYTES) return null
    return { mediaType: mime as ModelImage['mediaType'], data: bytes.toString('base64') }
  } catch {
    return null
  }
}
