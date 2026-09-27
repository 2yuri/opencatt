import { createContext, useContext, type ReactNode } from 'react'
import type { Post, PostMedia } from '@shared/api'

/** One file the viewer shows. Anything unknown is left out; the viewer reads what it can off the file. */
export interface ViewerItem {
  /** opencat-media:// URL. */
  url: string
  kind: 'image' | 'gif' | 'video'
  /** Shown in the info bar; the last piece of the URL when missing. */
  name?: string
  /** "Part 2", for a thread. */
  partLabel?: string
  sizeBytes?: number
  width?: number
  height?: number
  durationSec?: number
  /** Still converting for X (OP-67): a progress card stands in for the file. */
  converting?: { fraction: number }
  alt?: string
}

export interface ViewerOptions {
  /** Buttons for the info bar, before Close, e.g. RenderCard's "Use in a new post". */
  actions?: ReactNode
}

export interface MediaViewerApi {
  open(items: ViewerItem[], startIndex: number, options?: ViewerOptions): void
  close(): void
}

// Without a provider (a card rendered on its own in a test) opening does nothing.
const NOOP: MediaViewerApi = { open: () => {}, close: () => {} }

export const MediaViewerContext = createContext<MediaViewerApi>(NOOP)

/** The app's one full-size media viewer (OP-88). */
export function useMediaViewer(): MediaViewerApi {
  return useContext(MediaViewerContext)
}

/** A post's file as the viewer shows it. */
export function viewerItem(media: PostMedia, partLabel?: string): ViewerItem {
  return {
    url: media.url,
    kind: media.kind,
    partLabel,
    sizeBytes: media.bytes || undefined,
    width: media.width ?? undefined,
    height: media.height ?? undefined,
    durationSec: media.durationMs !== null ? media.durationMs / 1000 : undefined,
    alt: media.alt ?? undefined
  }
}

/** Every file of a post across its thread parts, in order, labelled "Part n" when it has more than one. */
export function viewerItemsForPost(post: Pick<Post, 'parts'>): ViewerItem[] {
  const thread = post.parts.length > 1
  return post.parts.flatMap((part, i) =>
    part.media.map((m) => viewerItem(m, thread ? `Part ${i + 1}` : undefined))
  )
}

/** "View image" or "View video", for a thumbnail that opens the viewer. */
export function viewLabel(kind: ViewerItem['kind']): string {
  return kind === 'video' ? 'View video' : 'View image'
}
