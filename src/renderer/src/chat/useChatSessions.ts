import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthStatus, ChatSession } from '@shared/api'
import { messageOf } from './useAgentChat'

export interface ChatSessions {
  /** False until main first answers. */
  loaded: boolean
  /** The active account's chats, newest first, as main lists them. */
  list: ChatSession[]
  /** The open chat: the one main marks active. Null while there is none yet. */
  current: ChatSession | null
  /** The active X account's handle, for the header and the list's heading; null before any. */
  handle: string | null
  /** Why the last create or switch failed, if it did. */
  error: string | null
  /** A new, empty chat that becomes the open one; null when main refused. */
  create(): Promise<ChatSession | null>
  /** Opens another chat. */
  select(id: string): Promise<void>
  /** Rejects with main's plain message, like an empty name. */
  rename(id: string, title: string): Promise<void>
  /** Rejects with main's plain message, like a chat the agent is still answering in. */
  remove(id: string): Promise<void>
}

/**
 * The active account's chats with the agent (OP-95). Main owns them; this mirrors the list and
 * reloads it whenever main says it changed (a message, a title, a turn starting or ending) or
 * the user switches X accounts.
 */
export function useChatSessions(): ChatSessions {
  const [list, setList] = useState<ChatSession[]>([])
  const [loaded, setLoaded] = useState(false)
  const [handle, setHandle] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The account whose chats are listed; undefined until auth answers, when every change counts.
  const account = useRef<string | null | undefined>(undefined)
  // Only the latest reload lands, so a slow answer never puts back an older list.
  const seq = useRef(0)
  const live = useRef(true)

  const reload = useCallback((): Promise<void> => {
    const n = ++seq.current
    return window.opencat.chat.sessions.list().then(
      (next) => {
        if (!live.current || n !== seq.current) return
        setList(next)
        setLoaded(true)
      },
      (err: unknown) => {
        if (live.current && n === seq.current) setError(messageOf(err))
      }
    )
  }, [])

  useEffect(() => {
    live.current = true
    const { chat, auth } = window.opencat
    const follow = (status: AuthStatus): void => {
      const id = status.activeAccountId
      setHandle(status.accounts.find((a) => a.id === id)?.handle ?? null)
      if (account.current === id) return
      const first = account.current === undefined
      account.current = id
      // Another account: its own chats, and its own open one.
      if (!first) void reload()
    }
    void reload()
    auth
      ?.status()
      .then((status) => live.current && follow(status))
      .catch(() => undefined)
    const stopAuth = auth?.onChanged(follow)
    const stop = chat.sessions.onChanged((event) => {
      if (account.current === undefined || event.accountId === account.current) void reload()
    })
    return () => {
      live.current = false
      stop()
      stopAuth?.()
    }
  }, [reload])

  const create = useCallback(async (): Promise<ChatSession | null> => {
    setError(null)
    try {
      const made = await window.opencat.chat.sessions.create()
      // Shown at once; the reload brings main's order and any other change.
      setList((was) => [made, ...was.map((s) => ({ ...s, active: false }))])
      void reload()
      return made
    } catch (err) {
      setError(messageOf(err))
      return null
    }
  }, [reload])

  const select = useCallback(
    async (id: string): Promise<void> => {
      setError(null)
      try {
        await window.opencat.chat.sessions.setActive(id)
        setList((was) => was.map((s) => ({ ...s, active: s.id === id })))
        void reload()
      } catch (err) {
        setError(messageOf(err))
      }
    },
    [reload]
  )

  const rename = useCallback(async (id: string, title: string): Promise<void> => {
    try {
      const renamed = await window.opencat.chat.sessions.rename(id, title)
      setList((was) => was.map((s) => (s.id === id ? { ...s, title: renamed.title } : s)))
    } catch (err) {
      throw new Error(messageOf(err), { cause: err })
    }
  }, [])

  const remove = useCallback(
    async (id: string): Promise<void> => {
      try {
        await window.opencat.chat.sessions.delete(id)
      } catch (err) {
        throw new Error(messageOf(err), { cause: err })
      }
      // Main picks the next open chat, or makes a new one for the last.
      await reload()
    },
    [reload]
  )

  const current = list.find((s) => s.active) ?? null
  return { loaded, list, current, handle, error, create, select, rename, remove }
}
