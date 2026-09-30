import { randomUUID } from 'node:crypto'
import type {
  AgentErrorCode,
  AgentEvent,
  AgentRunningTurn,
  AgentTurnStarted,
  ChatMessage,
  ChatSession,
  ComposerMode,
  ToolResult,
  VoiceProfile
} from '@shared/api'
import type { Platform } from '@shared/platforms'
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
  /** Autopilot is on for the agent here (OP-103): its posts are scheduled without approval. */
  autopilot?: boolean
  /** The platform it is on (OP-118); X when left out. The prompt follows its rules (OP-122). */
  platform?: Platform
}

/**
 * The account of the turn now running, for the tools, which are made once and serve every turn.
 * One turn runs at a time, so one slot is enough.
 */
export class TurnScope {
  current: TurnAccount | null = null
  /** The chat the running turn answers in (OP-94). */
  session: string | null = null
  /** The running turn's Stop, for tools that take long enough to be worth stopping. */
  signal: AbortSignal | null = null
  /** Media ids on the user's message the running turn answers, which go on its post (OP-89). */
  attached: readonly string[] = []
  /** render_video calls the running turn has made (OP-91). */
  videos = 0
}

/** An account's chats, as AgentSession needs them (OP-94). ChatSessionStore in the app. */
export interface Chats {
  /** The account's active chat, made when it has none. */
  active(account: string | null): string
  list(account: string | null): ChatSession[]
  create(account: string | null): ChatSession
  rename(id: string, title: string): ChatSession
  /** Removes the chat's row and returns its account; its messages are cleared first. */
  delete(id: string): string | null
  setActive(id: string): ChatSession
  get(id: string): ChatSession | null
  /** A message was saved; the first user message names the chat. */
  touch(id: string, userText?: string): void
}

const notKept = (): never => {
  throw new Error('Chats are not kept here')
}

/** One chat per account, named by the account's id, for tests and callers that don't keep chats. */
export const ONE_CHAT: Chats = {
  active: (account) => account ?? 'chat',
  list: () => [],
  create: notKept,
  rename: notKept,
  delete: () => null,
  setActive: notKept,
  get: () => null,
  touch: () => {}
}

/** What a runner gets for one turn: the history so far, and ways to report what it does. */
export interface AgentTurn {
  history: ChatMessage[]
  /** Null before any X account is connected. */
  account: TurnAccount | null
  /** The chat it answers in (OP-94), whose Claude Code session the CLI resumes. */
  sessionId: string
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

/** Where a turn's messages go: its account and its chat, fixed when it starts. */
interface Place {
  account: TurnAccount | null
  accountId: string | null
  sessionId: string
}

/**
 * One conversation, one turn at a time. The session is the only writer of the chat
 * history: it saves the user's message, the streamed reply and tool results, in order.
 */
export class AgentSession {
  private running: { turnId: string; abort: AbortController; place: Place } | null = null
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
    private readonly writing: () => string | null = () => null,
    /** Each account's chats (OP-94); a turn stays in the chat it started in. */
    private readonly chats: Chats = ONE_CHAT,
    /** An account's chats changed, for the panel's chat list. */
    private readonly chatsChanged: (accountId: string | null) => void = () => {}
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
    const place = this.place()
    const preface = this.preface(mode, trimmed, videoSeconds)
    this.save(turnId, place, 'user', trimmed, null, mediaIds, mode, preface)
    return this.start(turnId, place)
  }

  /** Runs a new turn on the active chat's history as it is, after an error. */
  retry(): AgentTurnStarted {
    this.assertIdle()
    return this.start(randomUUID(), this.place())
  }

  cancel(): void {
    this.running?.abort.abort()
  }

  /** The running turn's account and chat, or null when none runs (OP-96). */
  runningTurn(): AgentRunningTurn | null {
    if (!this.running) return null
    const { accountId, sessionId } = this.running.place
    return { accountId, sessionId }
  }

  /** The active chat of the active account, which is what the chat panel shows. */
  history(): ChatMessage[] {
    return this.chat.list(this.place().sessionId)
  }

  /**
   * Empties the active chat. Refused while a turn runs, which would go on saving into it.
   */
  clear(): void {
    this.assertIdle()
    this.discardMedia(this.chat.clear(this.place().sessionId))
  }

  /** An account's chats, the active account's when none is named (OP-94). */
  chatList(accountId?: string | null): ChatSession[] {
    const answering = this.running ? this.scope.session : null
    return this.chats
      .list(accountId === undefined ? this.accountId() : accountId)
      .map((chat) => ({ ...chat, streaming: chat.id === answering }))
  }

  /** A new chat, which becomes the active one. Allowed mid-turn: that turn keeps its chat. */
  newChat(accountId?: string | null): ChatSession {
    const account = accountId === undefined ? this.accountId() : accountId
    const made = this.chats.create(account)
    this.chatsChanged(account)
    return made
  }

  renameChat(id: string, title: string): ChatSession {
    const renamed = this.chats.rename(id, title)
    this.chatsChanged(renamed.accountId)
    return renamed
  }

  /** Deletes a chat and its messages. Refused for the chat a turn is answering in. */
  deleteChat(id: string): void {
    if (this.running && this.scope.session === id) {
      throw new Error('The agent is still answering in that chat')
    }
    if (!this.chats.get(id)) throw new Error('That chat no longer exists.')
    this.discardMedia(this.chat.clear(id))
    const account = this.chats.delete(id)
    this.chatsChanged(account)
  }

  setActiveChat(id: string): ChatSession {
    const active = this.chats.setActive(id)
    this.chatsChanged(active.accountId)
    return active
  }

  /** Stops the running turn and saves nothing more, for when the database is about to close. */
  close(): void {
    this.closed = true
    this.cancel()
  }

  private accountId(): string | null {
    return this.account()?.id ?? null
  }

  private place(): Place {
    const account = this.account()
    const accountId = account?.id ?? null
    return { account, accountId, sessionId: this.chats.active(accountId) }
  }

  private assertIdle(): void {
    if (this.closed) throw new Error('The agent has shut down')
    if (this.running) throw new Error('The agent is still answering')
  }

  private start(turnId: string, place: Place): AgentTurnStarted {
    const abort = new AbortController()
    this.running = { turnId, abort, place }
    this.scope.current = place.account
    this.scope.session = place.sessionId
    this.scope.signal = abort.signal
    // A retry answers the same message, so it finds the same files.
    const asked = this.chat.list(place.sessionId).findLast((m) => m.role === 'user')
    this.scope.attached = asked?.media.map((m) => m.id) ?? []
    this.scope.videos = 0
    this.idle = this.run(turnId, place, abort.signal).finally(() => {
      this.running = null
      this.scope.current = null
      this.scope.session = null
      this.scope.signal = null
      this.scope.attached = []
      this.scope.videos = 0
      // The chat stopped streaming, even when it isn't the open one.
      this.chatsChanged(place.accountId)
    })
    this.chatsChanged(place.accountId)
    return { turnId, accountId: place.accountId, sessionId: place.sessionId }
  }

  private async run(turnId: string, place: Place, signal: AbortSignal): Promise<void> {
    const { accountId, sessionId } = place
    const where = { accountId, sessionId }
    let pending = ''
    const via = this.via()
    const flush = (): void => {
      if (pending) this.save(turnId, place, 'assistant', pending, via)
      pending = ''
    }

    try {
      await this.runner.run({
        history: this.chat.list(sessionId),
        account: place.account,
        sessionId,
        writing: this.writing() ?? undefined,
        signal,
        text: (delta) => {
          if (signal.aborted || !delta) return
          pending += delta
          this.emit({ type: 'text', turnId, ...where, delta })
        },
        tool: (name) => {
          if (!signal.aborted) this.emit({ type: 'tool', turnId, ...where, name })
        },
        toolResult: (result) => {
          flush()
          this.save(turnId, place, 'tool', JSON.stringify(result))
        }
      })
      flush()
      this.emit({ type: 'done', turnId, ...where, stopped: signal.aborted })
    } catch (err) {
      flush()
      if (signal.aborted) {
        this.emit({ type: 'done', turnId, ...where, stopped: true })
        return
      }
      const code = err instanceof AgentError ? err.code : 'other'
      const message = err instanceof Error ? err.message : String(err)
      this.emit({ type: 'error', turnId, ...where, code, message })
    }
  }

  private save(
    turnId: string,
    place: Place,
    role: ChatMessage['role'],
    content: string,
    via: string | null = null,
    media: string[] = [],
    mode: ComposerMode = 'text',
    preface: string | null = null
  ): void {
    if (this.closed) return
    const { accountId, sessionId } = place
    const message = this.chat.append({
      role,
      content,
      via,
      media,
      accountId,
      mode,
      preface,
      sessionId
    })
    const before = this.chats.get(sessionId)
    this.chats.touch(sessionId, role === 'user' ? content : undefined)
    this.emit({ type: 'message', turnId, accountId, sessionId, message })
    // The chat moved to the top of the list, and its first message may have named it.
    if (before && (role === 'user' || before.title !== this.chats.get(sessionId)?.title)) {
      this.chatsChanged(accountId)
    }
  }
}
