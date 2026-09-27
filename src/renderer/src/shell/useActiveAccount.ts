import { useEffect, useState } from 'react'
import type { AuthStatus, XAccount } from '@shared/api'

/**
 * The X accounts and which one is active (OP-60), kept current with auth.onChanged. `status` is
 * null until auth answers; `active` is undefined while no account is active.
 */
export function useActiveAccount(): { status: AuthStatus | null; active: XAccount | undefined } {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  useEffect(() => {
    const auth = window.opencat.auth
    if (!auth) return
    let live = true
    const off = auth.onChanged((next) => live && setStatus(next))
    auth
      .status()
      .then((next) => live && setStatus(next))
      .catch(() => undefined)
    return () => {
      live = false
      off()
    }
  }, [])
  const active = status?.accounts.find((a) => a.id === status.activeAccountId)
  return { status, active }
}

/** Waiting posts per X account id, for the account switcher; accounts with none are left out. */
export function usePendingByAccount(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    // Optional, like auth below: some screen tests stub window.opencat with only a few calls.
    if (!window.opencat.posts.pendingByAccount) return
    let current = true
    const load = (): void => {
      window.opencat.posts
        .pendingByAccount()
        .then((result) => current && setCounts(result))
        .catch(() => undefined)
    }
    load()
    const stop = onPostsOrAccountChanged(load)
    return () => {
      current = false
      stop()
    }
  }, [])
  return counts
}

/**
 * Calls `load` whenever any post changes or the X accounts do: lists and counts default to the
 * active account, so switching accounts has to fetch them again. Returns a function that stops.
 */
export function onPostsOrAccountChanged(load: () => void): () => void {
  const stopPosts = window.opencat.posts.onChanged(load)
  // Optional: some screen tests stub window.opencat without auth.
  const stopAuth = window.opencat.auth?.onChanged(load)
  return () => {
    stopPosts()
    stopAuth?.()
  }
}
