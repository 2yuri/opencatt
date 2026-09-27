import { createContext, useContext } from 'react'
import type { LocalDate, Post, PostMedia } from '@shared/api'

/** What a new post starts with, like an agent render put in its first part (OP-33). */
export interface NewPostSeed {
  media?: PostMedia[]
}

export interface EditorApi {
  /** A blank post, on `day` when given; `seed` fills its first part. */
  openNew(day?: LocalDate, seed?: NewPostSeed): void
  /** An existing post; `focus: 'time'` puts the cursor on its date, for rescheduling. */
  openPost(post: Post, options?: { focus?: 'text' | 'time' }): void
}

export const EditorContext = createContext<EditorApi | null>(null)

export function useEditor(): EditorApi {
  const editor = useContext(EditorContext)
  if (!editor) throw new Error('useEditor needs an <EditorProvider> above it')
  return editor
}
