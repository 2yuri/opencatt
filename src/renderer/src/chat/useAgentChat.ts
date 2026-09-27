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

/** The conversation with the agent. Main saves every message; this only mirrors it. */
export function useAgentChat(): AgentChat {
  const [loaded, setLoaded] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState('')
  const [tool, setTool] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<ChatError | null>(null)

  // The X account whose conversation is shown (OP-61); undefined until auth answers, when every
  // event is shown, as before accounts.
  const active = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const { agent, chat, auth } = window.opencat
    const add = (message: ChatMessage): void =>
      setMessages((list) => (list.some((m) => m.id === message.id) ? list : [...list, message]))

    // Listen before loading, so a message saved in between is not lost.
    const stop = agent.onEvent((event) => {
      if (active.current !== undefined && event.accountId !== active.current) {
        // Another account's turn, still finishing there: only the one-turn-at-a-time lock matters.
        if (event.type === 'done' || event.type === 'error') setRunning(false)
        return
      }
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

    let live = true
    chat
      .list()
      .then((history) => {
        if (!live) return
        setMessages((list) => [
          ...history,
          ...list.filter((m) => !history.some((h) => h.id === m.id))
        ])
      })
      .catch((err: unknown) => live && setError({ code: 'other', message: messageOf(err) }))
      .finally(() => live && setLoaded(true))

    // Switching accounts switches conversations: main lists the active account's.
    const follow = (id: string | null): void => {
      if (active.current === id) return
      const first = active.current === undefined
      active.current = id
      if (first) return
      setStreaming('')
      setTool(null)
      setError(null)
      chat
        .list()
        .then((history) => live && active.current === id && setMessages(history))
        .catch((err: unknown) => live && setError({ code: 'other', message: messageOf(err) }))
    }
    auth
      ?.status()
      .then((status) => live && follow(status.activeAccountId))
      .catch(() => undefined)
    const stopAuth = auth?.onChanged((status) => follow(status.activeAccountId))

    return () => {
      live = false
      stop()
      stopAuth?.()
    }
  }, [])

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

  return { loaded, messages, streaming, tool, running, error, send, retry, cancel, clear }
}
