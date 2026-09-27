import { useEffect, useState } from 'react'
import type { PendingSummary } from '@shared/api'
import { onPostsOrAccountChanged } from '../shell/useActiveAccount'

/** How many posts wait for approval, fetched again whenever any post or the X account changes. */
export function usePending(): PendingSummary | null {
  const [pending, setPending] = useState<PendingSummary | null>(null)

  useEffect(() => {
    let current = true
    const load = (): void => {
      window.opencat.posts
        .pending()
        .then((result) => current && setPending(result))
        .catch(() => undefined)
    }
    load()
    const stop = onPostsOrAccountChanged(load)
    return () => {
      current = false
      stop()
    }
  }, [])

  return pending
}
