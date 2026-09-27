import { useCallback, useEffect, useRef, useState } from 'react'
import { messageOf } from '../chat/useAgentChat'

/** What main rejects an import with after cancelImport(); it clears the row without an error. */
export const IMPORT_CANCELLED = 'Adding the video was cancelled.'

/** How long an import may take before the row shows at 0%, so a quick one never flashes it. */
export const PROGRESS_DELAY_MS = 300

export interface ImportProgress {
  /** The video's file name. */
  name: string
  /** 0 to 1. */
  fraction: number
}

export interface MediaImport {
  pending: boolean
  /** The row to show while a video converts; null before it is worth showing. */
  progress: ImportProgress | null
  error: string | null
  /**
   * Runs one import or pick. `paths` are the files given to media.import; leave them out for
   * media.pick, whose paths only main knows. Resolves [] when the import failed or was cancelled.
   */
  run<T>(load: () => Promise<T[]>, paths?: string[]): Promise<T[]>
  /** Shows a message of the caller's own in the error row. */
  fail(message: string): void
  cancel(): void
  dismiss(): void
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path
const isVideo = (path: string): boolean => /\.(mp4|mov)$/i.test(path)

/**
 * One slot of media import (OP-67): whether it is pending, the conversion progress main reports
 * for its files, and the error it ended with. Main converts one video at a time, so the slot
 * follows progress for its own paths, or for any path while a pick is pending.
 */
export function useMediaImport(): MediaImport {
  const [pending, setPending] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Only the latest run may touch the state: an older one that settles late is ignored.
  const current = useRef(0)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const run = useCallback(async <T>(load: () => Promise<T[]>, paths?: string[]) => {
    const id = ++current.current
    const mine = (): boolean => live.current && current.current === id
    setPending(true)
    setProgress(null)
    setError(null)

    let heard = false
    const off = window.opencat.media.onProgress((event) => {
      if (!mine() || (paths && !paths.includes(event.path))) return
      heard = true
      setProgress({ name: baseName(event.path), fraction: event.fraction })
    })
    // A pick waits on the file dialog first, so only its first progress event shows the row.
    const video = paths?.find(isVideo)
    const timer = video
      ? setTimeout(() => {
          if (mine() && !heard) setProgress({ name: baseName(video), fraction: 0 })
        }, PROGRESS_DELAY_MS)
      : undefined

    try {
      return await load()
    } catch (err) {
      const message = messageOf(err)
      if (mine() && !message.endsWith(IMPORT_CANCELLED)) setError(message)
      return []
    } finally {
      clearTimeout(timer)
      off()
      if (mine()) {
        setPending(false)
        setProgress(null)
      }
    }
  }, [])

  const fail = useCallback((message: string) => setError(message), [])
  const cancel = useCallback(() => void window.opencat.media.cancelImport().catch(() => {}), [])
  const dismiss = useCallback(() => setError(null), [])

  return { pending, progress, error, run, fail, cancel, dismiss }
}
