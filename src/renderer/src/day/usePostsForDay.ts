import { useEffect, useState } from 'react'
import type { LocalDate, Post } from '@shared/api'
import { onPostsOrAccountChanged } from '../shell/useActiveAccount'

/** The posts of one local day, fetched again whenever any post or the X account changes. */
export function usePostsForDay(date: LocalDate): {
  posts: Post[] | null
  error: string | null
} {
  const [loaded, setLoaded] = useState<{ date: LocalDate; posts: Post[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    const load = (): void => {
      window.opencat.posts
        .listByDay(date)
        .then((posts) => {
          if (!current) return
          setLoaded({ date, posts })
          setError(null)
        })
        .catch((err: unknown) => {
          if (current) setError(String(err))
        })
    }
    load()
    const stop = onPostsOrAccountChanged(load)
    return () => {
      current = false
      stop()
    }
  }, [date])

  // Never show the previous day's posts under a new day's heading while it loads.
  return { posts: loaded?.date === date ? loaded.posts : null, error }
}
