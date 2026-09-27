import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { LocalDate, Post } from '@shared/api'
import { EditorContext, type EditorApi, type NewPostSeed } from './editorContext'
import { PostEditor } from './PostEditor'

type Open =
  | { kind: 'new'; day?: LocalDate; seed?: NewPostSeed; key: number }
  | { kind: 'post'; post: Post; focus: 'text' | 'time'; key: number }

/** Holds the one post editor the app has, so any screen or card can open it. */
export function EditorProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState<Open | null>(null)
  const close = useCallback(() => setOpen(null), [])

  const api = useMemo<EditorApi>(
    () => ({
      openNew: (day, seed) => setOpen({ kind: 'new', day, seed, key: Date.now() }),
      openPost: (post, options) =>
        setOpen({ kind: 'post', post, focus: options?.focus ?? 'text', key: Date.now() })
    }),
    []
  )

  return (
    <EditorContext.Provider value={api}>
      {children}
      {open && (
        <PostEditor
          key={open.key}
          post={open.kind === 'post' ? open.post : null}
          day={open.kind === 'new' ? open.day : undefined}
          seed={open.kind === 'new' ? open.seed : undefined}
          focus={open.kind === 'post' ? open.focus : 'text'}
          onClose={close}
        />
      )}
    </EditorContext.Provider>
  )
}
