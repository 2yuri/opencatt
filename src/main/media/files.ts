import { closeSync, openSync, readSync } from 'node:fs'
import { extname } from 'node:path'
import type { MediaKind } from '@shared/api'

export interface MediaType {
  kind: MediaKind
  mime: string
  ext: string
  /** X's upload limit for this kind. */
  maxBytes: number
}

const MB = 1024 * 1024

// What X accepts, by extension. Video codec and length are checked by OP-18, not here.
const TYPES: Record<string, MediaType> = {
  '.jpg': { kind: 'image', mime: 'image/jpeg', ext: '.jpg', maxBytes: 5 * MB },
  '.jpeg': { kind: 'image', mime: 'image/jpeg', ext: '.jpg', maxBytes: 5 * MB },
  '.png': { kind: 'image', mime: 'image/png', ext: '.png', maxBytes: 5 * MB },
  '.webp': { kind: 'image', mime: 'image/webp', ext: '.webp', maxBytes: 5 * MB },
  '.gif': { kind: 'gif', mime: 'image/gif', ext: '.gif', maxBytes: 15 * MB },
  '.mp4': { kind: 'video', mime: 'video/mp4', ext: '.mp4', maxBytes: 512 * MB },
  '.mov': { kind: 'video', mime: 'video/quicktime', ext: '.mov', maxBytes: 512 * MB }
}

export const SUPPORTED_EXTENSIONS = Object.keys(TYPES).map((ext) => ext.slice(1))

export function mediaTypeFor(path: string): MediaType | null {
  return TYPES[extname(path).toLowerCase()] ?? null
}

/** Checks the first bytes, so a renamed file can't pass as something X would take. */
export function looksLike(path: string, type: MediaType): boolean {
  const head = Buffer.alloc(12)
  const fd = openSync(path, 'r')
  let read: number
  try {
    read = readSync(fd, head, 0, head.length, 0)
  } finally {
    closeSync(fd)
  }
  if (read < 12) return false
  switch (type.mime) {
    case 'image/jpeg':
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
    case 'image/png':
      return head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    case 'image/gif':
      return head.subarray(0, 4).toString('latin1') === 'GIF8'
    case 'image/webp':
      return (
        head.subarray(0, 4).toString('latin1') === 'RIFF' &&
        head.subarray(8, 12).toString('latin1') === 'WEBP'
      )
    default:
      // MP4 and MOV are ISO base media files: "ftyp" at offset 4.
      return head.subarray(4, 8).toString('latin1') === 'ftyp'
  }
}

/** Media files are named <uuid>.<ext>; anything else is never served or deleted. */
export const MEDIA_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{3,4}$/

export const MEDIA_PROTOCOL = 'opencat-media'

export function mediaUrl(file: string): string {
  return `${MEDIA_PROTOCOL}://media/${file}`
}
