import { useEffect, useState } from 'react'
import type { LocalDate, Post } from '@shared/api'
import { onPostsOrAccountChanged } from '../shell/useActiveAccount'

export type PostsByDay = Record<LocalDate, Post[]>

/**
 * Posts per day for the grid's range, fetched again whenever any post or the X account changes.
 */
export function useDayPosts(
  from: LocalDate,
  to: LocalDate
): { posts: PostsByDay; error: string | null } {
  const [posts, setPosts] = useState<PostsByDay>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    const load = (): void => {
      window.opencat.posts
        .listRange(from, to)
        .then((result) => {
          if (!current) return
          setPosts(result)
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
  }, [from, to])

  return { posts, error }
}
