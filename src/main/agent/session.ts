import { randomUUID } from 'node:crypto'
import type {
  AgentErrorCode,
  AgentEvent,
  AgentTurnStarted,
  ChatMessage,
  ComposerMode,
  ToolResult,
  VoiceProfile
} from '@shared/api'
import type { ChatStore } from '../db'

/** A failure the chat panel can explain to the user. Anything else is reported as "other". */
export class AgentError extends Error {
  override name = 'AgentError'

  constructor(
    readonly code: AgentErrorCode,
    message: string
  ) {
    super(message)
  }
}

/** The X account a turn writes for: its posts, its conversation, its voice. */
export interface TurnAccount {
  id: string
  handle: string
  name: string | null
  /** The voice the user saved for it (OP-74), read when the turn starts. */
  voice?: VoiceProfile
}

/**
 * The account of the turn now running, for the tools, which are made once and serve every turn.
 * One turn runs at a time, so one slot is enough.
 */
export class TurnScope {
  current: TurnAccount | null = null
  /** The running turn's Stop, for tools that take long enough to be worth stopping. */
  signal: AbortSignal | null = null
  /** Media ids on the user's message the running turn answers, which go on its post (OP-89). */
  attached: readonly string[] = []
}

/** What a runner gets for one turn: the history so far, and ways to report what it does. */
export interface AgentTurn {
  history: ChatMessage[]
  /** Null before any X account is connected. */
  account: TurnAccount | null
  /** The writing guide in use (OP-74); the built-in one when absent. */
  writing?: string
  signal: AbortSignal
  /** More of the assistant's reply. */
  text(delta: string): void
  /** A tool call started. */
  tool(name: string): void
  /** A tool call touched posts; saved to the history as a "tool" message. */
  toolResult(result: ToolResult): void
}

/** The model side of the agent: AnthropicRunner in the app, a fake in tests. */
export interface AgentRunner {
  run(turn: AgentTurn): Promise<void>
}

/**
 * One conversation, one turn at a time. The session is the only writer of the chat
 * history: it saves the user's message, the streamed reply and tool results, in order.
 */
export class AgentSession {
  private running: { turnId: string; abort: AbortController } | null = null
  private closed = false

  /** Resolves when the running turn, if any, has finished. */
  idle: Promise<void> = Promise.resolve()

  constructor(
    private readonly chat: ChatStore,
    private readonly runner: AgentRunner,
    private readonly emit: (event: AgentEvent) => void,
    /** Who answers this turn, saved on its replies. */
    private readonly via: () => string | null = () => null,
    /** Files the cleared chat held; unattached ones are removed. */
    private readonly discardMedia: (ids: string[]) => void = () => {},
    /** The active X account, read when a turn starts; the turn keeps it to the end. */
    private readonly account: () => TurnAccount | null = () => null,
    private readonly scope: TurnScope = new TurnScope(),
    /** What goes before the user's text for a mode, like Video's pre-prompt (OP-81). */
    private readonly preface: (
      mode: ComposerMode,
      text: string,
      videoSeconds?: number
    ) => string | null = () => null,
    /** The writing guide in use, read when a turn starts (OP-74); null for the built-in one. */
    private readonly writing: () => string | null = () => null
  ) {}

  send(
    text: string,
    mediaIds: string[] = [],
    mode: ComposerMode = 'text',
    videoSeconds?: number
  ): AgentTurnStarted {
    const trimmed = text.trim()
    if (!trimmed && mediaIds.length === 0) throw new Error('Type a message first')
    this.assertIdle()
    const turnId = randomUUID()
    const account = this.account()
    const preface = this.preface(mode, trimmed, videoSeconds)
    this.save(turnId, account?.id ?? null, 'user', trimmed, null, mediaIds, mode, preface)
    return this.start(turnId, account)
  }

  /** Runs a new turn on the active account's history as it is, after an error. */
  retry(): AgentTurnStarted {
    this.assertIdle()
    return this.start(randomUUID(), this.account())
  }

  cancel(): void {
    this.running?.abort.abort()
  }

  /** The active account's conversation, which is what the chat panel shows. */
  history(): ChatMessage[] {
    return this.chat.list(this.account()?.id ?? null)
  }

  /**
   * Empties the active account's history. Refused while a turn runs, which would go on saving
   * into it.
   */
  clear(): void {
    this.assertIdle()
    this.discardMedia(this.chat.clear(this.account()?.id ?? null))
  }

  /** Stops the running turn and saves nothing more, for when the database is about to close. */
  close(): void {
    this.closed = true
    this.cancel()
  }

  private assertIdle(): void {
    if (this.closed) throw new Error('The agent has shut down')
    if (this.running) throw new Error('The agent is still answering')
  }

  private start(turnId: string, account: TurnAccount | null): AgentTurnStarted {
    const abort = new AbortController()
    this.running = { turnId, abort }
    this.scope.current = account
    this.scope.signal = abort.signal
    // A retry answers the same message, so it finds the same files.
    const asked = this.chat.list(account?.id ?? null).findLast((m) => m.role === 'user')
    this.scope.attached = asked?.media.map((m) => m.id) ?? []
    this.idle = this.run(turnId, account, abort.signal).finally(() => {
      this.running = null
      this.scope.current = null
      this.scope.signal = null
      this.scope.attached = []
    })
    return { turnId, accountId: account?.id ?? null }
  }

  private async run(
    turnId: string,
    account: TurnAccount | null,
    signal: AbortSignal
  ): Promise<void> {
    const accountId = account?.id ?? null
    let pending = ''
    const via = this.via()
    const flush = (): void => {
      if (pending) this.save(turnId, accountId, 'assistant', pending, via)
      pending = ''
    }

    try {
      await this.runner.run({
        history: this.chat.list(accountId),
        account,
        writing: this.writing() ?? undefined,
        signal,
        text: (delta) => {
          if (signal.aborted || !delta) return
          pending += delta
          this.emit({ type: 'text', turnId, accountId, delta })
        },
        tool: (name) => {
          if (!signal.aborted) this.emit({ type: 'tool', turnId, accountId, name })
        },
        toolResult: (result) => {
          flush()
          this.save(turnId, accountId, 'tool', JSON.stringify(result))
        }
      })
      flush()
      this.emit({ type: 'done', turnId, accountId, stopped: signal.aborted })
    } catch (err) {
      flush()
      if (signal.aborted) {
        this.emit({ type: 'done', turnId, accountId, stopped: true })
        return
      }
      const code = err instanceof AgentError ? err.code : 'other'
      const message = err instanceof Error ? err.message : String(err)
      this.emit({ type: 'error', turnId, accountId, code, message })
    }
  }

  private save(
    turnId: string,
    accountId: string | null,
    role: ChatMessage['role'],
    content: string,
    via: string | null = null,
    media: string[] = [],
    mode: ComposerMode = 'text',
    preface: string | null = null
  ): void {
    if (this.closed) return
    const message = this.chat.append({ role, content, via, media, accountId, mode, preface })
    this.emit({ type: 'message', turnId, accountId, message })
  }
}
