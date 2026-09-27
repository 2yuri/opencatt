import { useCallback, useEffect, useRef, useState } from 'react'
import type { PostMedia } from '@shared/api'
import { messageOf } from './useAgentChat'
import { fileSources } from '../media/fileSources'
import { useMediaImport, type ImportProgress } from '../media/useMediaImport'

/** How many files one message can carry: enough for a thread with an image on every post. */
export const MAX_CHAT_FILES = 20

export interface Attachment {
  media: PostMedia
  /** The file's own name when we know it (dropped files); the chip falls back to its kind. */
  name: string | null
}

export interface Attachments {
  list: Attachment[]
  busy: boolean
  /** A video being converted for X, once it is worth showing. */
  progress: ImportProgress | null
  error: string | null
  addFiles(files: File[]): Promise<void>
  pick(): Promise<void>
  remove(id: string): void
  /** Stops the video conversion the pending import waits on. */
  cancel(): void
  dismiss(): void
  /** Hands the ids to the message being sent and empties the strip without discarding them. */
  take(): string[]
}

/** Files waiting in the composer. Main copies each in on import; removing one discards it. */
export function useAttachments(): Attachments {
  const [list, setList] = useState<Attachment[]>([])
  const importer = useMediaImport()
  const { run, fail, dismiss } = importer
  // Read by add() after an await, when the list it closed over may be stale.
  const count = useRef(0)
  useEffect(() => {
    count.current = list.length
  }, [list])

  const add = useCallback(
    async (load: () => Promise<Attachment[]>, paths?: string[]) => {
      const added = await run(load, paths)
      const room = MAX_CHAT_FILES - count.current
      added
        .slice(room)
        .forEach((a) => void window.opencat.media.discard(a.media.id).catch(() => {}))
      if (added.length > room) fail(`Attach up to ${MAX_CHAT_FILES} files to one message.`)
      setList((all) => [...all, ...added.slice(0, Math.max(0, room))])
    },
    [run, fail]
  )

  const addFiles = useCallback(
    async (files: File[]) => {
      let sources
      try {
        const found = fileSources(files)
        sources = Array.isArray(found) ? found : await found
      } catch (err) {
        fail(messageOf(err))
        return
      }
      const paths = sources.map((s) => s.path)
      await add(async () => {
        const media = await window.opencat.media.import(paths)
        return media.map((m, i) => ({ media: m, name: sources[i]?.name ?? null }))
      }, paths)
    },
    [add, fail]
  )

  const pick = useCallback(
    () =>
      add(async () => (await window.opencat.media.pick()).map((m) => ({ media: m, name: null }))),
    [add]
  )

  const remove = useCallback((id: string) => {
    setList((all) => all.filter((a) => a.media.id !== id))
    void window.opencat.media.discard(id).catch(() => {})
  }, [])

  const take = useCallback(() => {
    const ids = list.map((a) => a.media.id)
    setList([])
    dismiss()
    return ids
  }, [list, dismiss])

  return {
    list,
    busy: importer.pending,
    progress: importer.progress,
    error: importer.error,
    addFiles,
    pick,
    remove,
    cancel: importer.cancel,
    dismiss,
    take
  }
}
