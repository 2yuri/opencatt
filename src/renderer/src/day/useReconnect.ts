import { useEffect, useRef, useState } from 'react'
import type { Post, XAccount } from '@shared/api'
import { authErrorMessage } from '@shared/authErrors'

/**
 * The connected X accounts, kept current with auth.onChanged. Empty until status answers, and
 * while `enabled` is false, so cards that don't need them don't ask.
 */
export function useXAccounts(enabled = true): XAccount[] {
  const [accounts, setAccounts] = useState<XAccount[]>([])
  useEffect(() => {
    if (!enabled) return
    let live = true
    const off = window.opencat.auth.onChanged((status) => setAccounts(status.accounts))
    window.opencat.auth
      .status()
      .then((status) => live && setAccounts(status.accounts))
      .catch(() => {})
    return () => {
      live = false
      off()
    }
  }, [enabled])
  return accounts
}

/** Where Check on X points: the profile by handle, or by id while the handle is unknown. */
export function profileUrl(accountId: string, accounts: XAccount[]): string {
  const handle = accounts.find((a) => a.id === accountId)?.handle
  return handle ? `https://x.com/${handle}` : `https://x.com/i/user/${accountId}`
}

export type Reconnect =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'error'; message: string }
  | { state: 'reconnected'; handle: string }

/**
 * Reconnect X on an auth-failed card: auth.connect, then the card offers Post now and Reschedule.
 * Nothing is resent on its own. Whether the account is signed out comes from auth.status, so
 * reconnecting from one card clears every card of that account; only connecting and its error
 * are this card's own. Calling connect again while one is pending cancels the first, so only the
 * latest call's answer counts.
 */
export function useReconnect(
  post: Post,
  account: XAccount | undefined
): { reconnect: Reconnect; connect: () => void } {
  const [local, setReconnect] = useState<Reconnect>({ state: 'idle' })
  const latest = useRef(0)
  useEffect(() => () => void (latest.current = -1), [])

  function connect(): void {
    const call = ++latest.current
    setReconnect({ state: 'connecting' })
    const settle = (next: Reconnect): void => {
      if (call === latest.current) setReconnect(next)
    }
    window.opencat.auth
      .connect()
      .then(async ({ accountId, handle }) => {
        if (!post.accountId || accountId === post.accountId) {
          return settle({ state: 'reconnected', handle })
        }
        // Signed in as someone else: that account is connected now, but this post's still isn't.
        const status = await window.opencat.auth.status().catch(() => null)
        const owner = status?.accounts.find((a) => a.id === post.accountId)?.handle
        settle({
          state: 'error',
          message: `You signed in as @${handle}. This post is for ${owner ? `@${owner}` : 'another account'}: sign in to X as that account and try again.`
        })
      })
      .catch((err: unknown) => settle({ state: 'error', message: authErrorMessage(err) }))
  }

  // Signed out again later: this card's own "reconnected" no longer holds.
  const needsReconnect = account?.needsReconnect
  const [seen, setSeen] = useState(needsReconnect)
  if (seen !== needsReconnect) {
    setSeen(needsReconnect)
    if (needsReconnect && local.state === 'reconnected') setReconnect({ state: 'idle' })
  }

  // Signed in again, here or anywhere else: auth.status says so once it knows the account.
  const signedIn = account !== undefined && !account.needsReconnect
  const reconnect: Reconnect =
    local.state === 'connecting' || local.state === 'reconnected'
      ? local
      : signedIn
        ? { state: 'reconnected', handle: account.handle }
        : local
  return { reconnect, connect }
}
