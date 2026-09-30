import { useCallback, useEffect, useRef, useState } from 'react'

/** Main-process errors arrive as "Error invoking remote method 'x': SomeError: message". */
const messageOf = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(
    /^Error invoking remote method '[^']+': (\w*Error: )?/,
    ''
  )

export interface Autopilot {
  /** null until main answers, or while there is no account. */
  on: boolean | null
  /** Turns it on or off; one call at a time. A refusal puts the switch back and sets `error`. */
  set(on: boolean): Promise<void>
  error: string | null
  /** A set is on its way: the switch waits, and a late read can't flip it back. */
  pending: boolean
}

interface State {
  /** Whose state this is: another account's is not shown. */
  accountId: string
  on: boolean | null
  error: string | null
  pending: boolean
}

/**
 * An X account's Autopilot (OP-104): read from main, kept current with autopilot.onChanged, and
 * changed with `set`. No account id, no Autopilot.
 */
export function useAutopilot(accountId: string | undefined): Autopilot {
  const [state, setState] = useState<State | null>(null)
  // Bumped by every set and account change, so an answer to an older read or set is dropped.
  const version = useRef(0)
  const busy = useRef(false)

  useEffect(() => {
    version.current++
    busy.current = false
    // Optional: some screen tests stub window.opencat without autopilot.
    const autopilot = window.opencat.autopilot
    if (!accountId || !autopilot) return
    const asked = version.current
    let live = true
    const show = (on: boolean): void =>
      setState((was) =>
        was?.accountId === accountId
          ? { ...was, on }
          : { accountId, on, error: null, pending: false }
      )
    autopilot
      .get(accountId)
      .then((value) => live && asked === version.current && show(value))
      .catch(() => live && asked === version.current && show(false))
    const off = autopilot.onChanged((event) => {
      if (live && event.accountId === accountId) show(event.on)
    })
    return () => {
      live = false
      off()
    }
  }, [accountId])

  const set = useCallback(
    async (next: boolean): Promise<void> => {
      const autopilot = window.opencat.autopilot
      if (!accountId || !autopilot || busy.current) return
      busy.current = true
      const mine = ++version.current
      const current = (): boolean => mine === version.current
      setState({ accountId, on: next, error: null, pending: true })
      try {
        const value = await autopilot.set(accountId, next)
        if (current()) setState({ accountId, on: value, error: null, pending: false })
      } catch (err) {
        if (current()) {
          setState({ accountId, on: !next, error: messageOf(err), pending: false })
        }
      } finally {
        if (current()) busy.current = false
      }
    },
    [accountId]
  )

  const mine = state !== null && state.accountId === accountId ? state : null
  return {
    on: mine?.on ?? null,
    set,
    error: mine?.error ?? null,
    pending: mine?.pending ?? false
  }
}
