import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentErrorCode, ChatMessage, ComposerMode } from '@shared/api'

export interface ChatError {
  code: AgentErrorCode
  message: string
}

export interface AgentChat {
  loaded: boolean
  messages: ChatMessage[]
  /** The assistant's reply so far, before main saves it. */
  streaming: string
  /** The tool the agent is running, if any. */
  tool: string | null
  running: boolean
  /**
   * The turn main is running anywhere in the app, from its events, whatever chat or account it is
   * in. Main runs one turn at a time for the whole app, so nothing else can send until it ends.
   */
  busy: { accountId: string | null; sessionId: string | null } | null
  error: ChatError | null
  send(text: string, mediaIds?: string[], mode?: ComposerMode, videoSeconds?: number): Promise<void>
  retry(): Promise<void>
  cancel(): Promise<void>
  clear(): Promise<void>
}

/** IPC rejections arrive as "Error invoking remote method 'x': Error: message". */
export function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}

/**
 * The conversation with the agent. Main saves every message; this only mirrors it.
 *
 * `sessionId` is the open chat (OP-95): only its turn's events are drawn, so a reply still coming
 * in for another chat goes on in main, saved there, without showing here. Undefined while the
 * chats aren't known, when every event of the active account is shown, as before chats.
 * `sessionStreaming` is main's word that the open chat has a turn running, for a chat opened
 * mid-reply.
 */
export function useAgentChat(sessionId?: string | null, sessionStreaming = false): AgentChat {
  const [loaded, setLoaded] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState('')
  const [tool, setTool] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState<AgentChat['busy']>(null)
  const [error, setError] = useState<ChatError | null>(null)

  // The X account whose conversation is shown (OP-61); undefined until auth answers, when every
  // event is shown, as before accounts.
  const active = useRef<string | null | undefined>(undefined)
  // The chat whose events are drawn; see sessionId above.
  const shown = useRef<string | null | undefined>(sessionId)
  // Only the latest load lands, when switches come quicker than main answers.
  const loads = useRef(0)
  const live = useRef(true)

  // Loads the open chat's history, keeping what its events added meanwhile.
  const load = useCallback((): void => {
    const n = ++loads.current
    window.opencat.chat
      .list()
      .then((history) => {
        if (!live.current || n !== loads.current) return
        setMessages((list) => [
          ...history,
          ...list.filter((m) => !history.some((h) => h.id === m.id))
        ])
      })
      .catch(
        (err: unknown) =>
          live.current &&
          n === loads.current &&
          setError({ code: 'other', message: messageOf(err) })
      )
      .finally(() => live.current && n === loads.current && setLoaded(true))
  }, [])

  useEffect(() => {
    live.current = true
    const { agent, auth } = window.opencat
    const add = (message: ChatMessage): void =>
      setMessages((list) => (list.some((m) => m.id === message.id) ? list : [...list, message]))

    // Listen before loading, so a message saved in between is not lost.
    const stop = agent.onEvent((event) => {
      // Before any filter: the app-wide one-turn lock follows every turn (OP-95 review).
      if (event.type === 'done' || event.type === 'error') setBusy(null)
      else
        setBusy((was) =>
          was?.accountId === event.accountId && was.sessionId === event.sessionId
            ? was
            : { accountId: event.accountId, sessionId: event.sessionId }
        )
      if (active.current !== undefined && event.accountId !== active.current) {
        // Another account's turn, still finishing there: only the one-turn-at-a-time lock matters.
        if (event.type === 'done' || event.type === 'error') setRunning(false)
        return
      }
      // Another chat's turn: it goes on in main and is saved there; that chat shows it when opened.
      if (shown.current !== undefined && event.sessionId !== shown.current) return
      switch (event.type) {
        case 'message':
          add(event.message)
          if (event.message.role !== 'user') setStreaming('')
          if (event.message.role === 'tool') setTool(null)
          break
        case 'text':
          setTool(null)
          setStreaming((text) => text + event.delta)
          break
        case 'tool':
          setTool(event.name)
          break
        case 'done':
          setRunning(false)
          setStreaming('')
          setTool(null)
          break
        case 'error':
          setRunning(false)
          setStreaming('')
          setTool(null)
          setError({ code: event.code, message: event.message })
          break
      }
    })

    load()

    // Switching accounts switches conversations: main lists the active account's.
    const follow = (id: string | null): void => {
      if (active.current === id) return
      const first = active.current === undefined
      active.current = id
      // With chats known, the account's open chat changes too, and that reloads it below.
      if (first || shown.current !== undefined) return
      setStreaming('')
      setTool(null)
      setError(null)
      setMessages([])
      load()
    }
    auth
      ?.status()
      .then((status) => live.current && follow(status.activeAccountId))
      .catch(() => undefined)
    const stopAuth = auth?.onChanged((status) => follow(status.activeAccountId))

    return () => {
      live.current = false
      stop()
      stopAuth?.()
    }
  }, [load])

  // Another chat opened: a new one, one from the list, or the next after a delete or an account
  // switch. Its history replaces this one's; a turn still running in it shows as running.
  useEffect(() => {
    const was = shown.current
    shown.current = sessionId
    if (sessionId === undefined || was === sessionId) return
    if (was !== undefined) {
      setMessages([])
      setLoaded(false)
      setStreaming('')
      setTool(null)
      setError(null)
      setRunning(false)
    }
    load()
  }, [sessionId, load])

  const start = useCallback(async (call: () => Promise<unknown>) => {
    setError(null)
    setRunning(true)
    try {
      await call()
    } catch (err) {
      setRunning(false)
      setError({ code: 'other', message: messageOf(err) })
    }
  }, [])

  const send = useCallback(
    (text: string, mediaIds: string[] = [], mode: ComposerMode = 'text', videoSeconds?: number) =>
      start(() =>
        // The length only means something in Video mode.
        mode === 'video' && videoSeconds !== undefined
          ? window.opencat.agent.send(text, mediaIds, mode, videoSeconds)
          : window.opencat.agent.send(text, mediaIds, mode)
      ),
    [start]
  )
  const retry = useCallback(() => start(() => window.opencat.agent.retry()), [start])
  const cancel = useCallback(() => window.opencat.agent.cancel(), [])
  const clear = useCallback(async () => {
    try {
      await window.opencat.chat.clear()
      setMessages([])
      setError(null)
    } catch (err) {
      setError({ code: 'other', message: messageOf(err) })
    }
  }, [])

  return {
    loaded,
    messages,
    streaming,
    tool,
    running: running || sessionStreaming,
    busy,
    error,
    send,
    retry,
    cancel,
    clear
  }
}
