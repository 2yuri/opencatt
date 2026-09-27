import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { ChatMessage, JsonValue } from '@shared/api'
import { parseToolResult, toolNote } from '@shared/toolResult'
import type { SettingsStore } from '../../db'
import {
  MAX_TRANSCRIPT_IMAGES,
  imagesOf,
  noImages,
  type ImageLoader,
  type ModelImage
} from '../images'
import {
  DEFAULT_WRITING,
  accountNote,
  basePrompt,
  attachmentNote,
  modeNote,
  when,
  zoneNote
} from '../prompt'
import { AgentError, type AgentRunner, type AgentTurn } from '../session'
import type { AgentMcpEndpoint } from './endpoint'
import { SERVER_NAME } from './endpoint'
import type { ClaudeCommand } from './find'
import { parseCliLine } from './stream'

const SESSION_SETTING = 'agent.cliSession'
const sessionKey = (account: string): string => `${SESSION_SETTING}.${account}`
const TOOL_PREFIX = `mcp__${SERVER_NAME}__`
/** How long a stopped CLI gets to exit before it is killed outright. */
const KILL_GRACE_MS = 1000

/** Codes the CLI puts on an assistant message when the login is the problem. */
const LOGIN_ERRORS = new Set(['authentication_failed', 'oauth_token_revoked', 'invalid_api_key'])

export interface CliSession {
  id: string
  /** The last user message this session has answered; gone from the chat means start fresh. */
  answered: string
}

export interface ClaudeCliOptions {
  endpoint: AgentMcpEndpoint
  /** Tool names for --allowedTools, as the CLI sees them. */
  allowedTools: string[]
  find: () => ClaudeCommand | null
  /** A folder of OpenCatt's own, so the CLI never runs in a project with a CLAUDE.md. */
  workDir: string
  settings: SettingsStore
  /** The CLI's model; its own default when unset. */
  model?: () => string | null
  spawn?: (command: string, args: string[], options: SpawnOptions) => ChildProcess
  /** Attached images for the model; none when unset. */
  images?: ImageLoader
  /**
   * The Claude Code session each chat is in (OP-94), so chats never share a context. Without it
   * the session is kept per account in settings, as before chats.
   */
  chats?: {
    cli(chatId: string): CliSession | null
    setCli(chatId: string, session: CliSession): void
  }
}

/** The flags that keep the CLI to OpenCatt's tools. Exported so a test can pin them. */
export function cliArgs(o: {
  mcpConfig: string
  systemPrompt: string
  allowedTools: string[]
  session: { resume: string } | { start: string }
  model: string | null
  /** The prompt comes as a stream-json user message, which is how the CLI takes images. */
  jsonInput?: boolean
}): string[] {
  return [
    '-p',
    ...(o.jsonInput ? ['--input-format', 'stream-json'] : []),
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    // No built-in tools at all: no shell, no files, no web.
    '--tools',
    '',
    // Only OpenCatt's MCP server, never the user's own.
    '--strict-mcp-config',
    '--mcp-config',
    o.mcpConfig,
    '--allowedTools',
    o.allowedTools.join(','),
    // Anything not allowed above is refused, never asked about.
    '--permission-mode',
    'dontAsk',
    // Skip the user's settings, hooks and plugins; the login still works.
    '--setting-sources',
    '',
    '--system-prompt-file',
    o.systemPrompt,
    ...('resume' in o.session ? ['--resume', o.session.resume] : ['--session-id', o.session.start]),
    ...(o.model ? ['--model', o.model] : [])
  ]
}

const stamped = (m: ChatMessage): string =>
  [
    [m.preface, m.content].filter(Boolean).join('\n\n'),
    modeNote(m),
    attachmentNote(m),
    `(Sent ${when(new Date(m.createdAt))}.)`
  ]
    .filter(Boolean)
    .join('\n')

/** One stream-json user message: the images, then the prompt. */
function userLine(prompt: string, images: ModelImage[]): string {
  const content = [
    ...images.map((image) => ({
      type: 'image',
      source: { type: 'base64', media_type: image.mediaType, data: image.data }
    })),
    { type: 'text', text: prompt }
  ]
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`
}

/** The saved chat as one prompt, for a fresh CLI session that hasn't seen it. */
function transcript(history: ChatMessage[], last: ChatMessage): string {
  const earlier = history
    .filter((m) => m !== last)
    .map((m) => {
      if (m.role === 'user') return `User: ${stamped(m)}`
      if (m.role === 'assistant') return `You: ${m.content}`
      const result = parseToolResult(m.content)
      return result ? toolNote(result) : ''
    })
    .filter(Boolean)
  if (earlier.length === 0) return stamped(last)
  return `The conversation so far, for context:\n\n${earlier.join('\n\n')}\n\nThe user's new message:\n\n${stamped(last)}`
}

/**
 * Runs the agent through the user's own claude CLI and Claude plan. One process per turn; the
 * CLI keeps the conversation itself and is resumed by session id.
 */
export class ClaudeCliRunner implements AgentRunner {
  constructor(private readonly o: ClaudeCliOptions) {}

  async run(turn: AgentTurn): Promise<void> {
    const found = this.o.find()
    if (!found) {
      throw new AgentError(
        'no_cli',
        'Claude Code is not installed. Install it from claude.com/claude-code, log in, then try again.'
      )
    }
    const lastUser = [...turn.history].reverse().find((m) => m.role === 'user')
    if (!lastUser) throw new AgentError('other', 'There is no message to answer.')
    const retrying = turn.history.at(-1) !== lastUser

    const saved = this.o.chats
      ? this.o.chats.cli(turn.sessionId)
      : this.session(turn.account?.id ?? null)
    const known = saved && turn.history.some((m) => m.id === saved.answered) ? saved : null
    try {
      await this.once(turn, found, lastUser, known, retrying)
    } catch (err) {
      // The CLI lost the session (deleted, or made on another machine): start again from the chat.
      if (known && err instanceof AgentError && /no conversation found/i.test(err.message)) {
        await this.once(turn, found, lastUser, null, false)
      } else throw err
    }
  }

  private async once(
    turn: AgentTurn,
    found: ClaudeCommand,
    lastUser: ChatMessage,
    known: CliSession | null,
    retrying: boolean
  ): Promise<void> {
    const sessionId = known?.id ?? randomUUID()
    const prompt = known
      ? retrying
        ? 'Please continue. Check the tool notes and list_posts before redoing anything.'
        : stamped(lastUser)
      : transcript(turn.history, lastUser)

    mkdirSync(this.o.workDir, { recursive: true })
    const mcpConfig = join(this.o.workDir, 'mcp-config.json')
    const systemPrompt = join(this.o.workDir, 'system-prompt.txt')
    // The token is in this file, so only the user may read it.
    writeFileSync(mcpConfig, JSON.stringify(await this.o.endpoint.config()), { mode: 0o600 })
    writeFileSync(
      systemPrompt,
      [basePrompt(turn.writing ?? DEFAULT_WRITING), zoneNote(), accountNote(turn.account)]
        .filter(Boolean)
        .join('\n\n')
    )

    // A resumed session has seen earlier images; a fresh one gets the newest few again.
    const load = this.o.images ?? noImages
    const images = retrying
      ? []
      : (known ? [lastUser] : turn.history.filter((m) => m.role === 'user'))
          .flatMap((m) => imagesOf(m, load))
          .slice(-MAX_TRANSCRIPT_IMAGES)

    const args = cliArgs({
      mcpConfig,
      systemPrompt,
      allowedTools: this.o.allowedTools,
      session: known ? { resume: sessionId } : { start: sessionId },
      model: this.o.model?.() ?? null,
      jsonInput: images.length > 0
    })
    const child = (this.o.spawn ?? nodeSpawn)(found.command, [...found.prefix, ...args], {
      cwd: this.o.workDir,
      env: { ...process.env, ...found.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    const stopListening = this.o.endpoint.listen((result) => turn.toolResult(result))
    const onAbort = (): void => {
      child.kill('SIGTERM')
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), KILL_GRACE_MS).unref()
    }
    turn.signal.addEventListener('abort', onAbort, { once: true })

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000)
    })
    const exited = new Promise<{ code: number | null; error?: NodeJS.ErrnoException }>(
      (resolve) => {
        child.once('error', (error: NodeJS.ErrnoException) => resolve({ code: null, error }))
        child.once('close', (code) => resolve({ code }))
      }
    )

    child.stdin?.end(images.length ? userLine(prompt, images) : prompt)

    let result: { isError: boolean; text: string } | null = null
    let apiError: string | null = null
    try {
      if (child.stdout) {
        for await (const line of createInterface({ input: child.stdout })) {
          const event = parseCliLine(line, TOOL_PREFIX)
          if (!event) continue
          if (event.kind === 'text') turn.text(event.delta)
          else if (event.kind === 'tool') turn.tool(event.name)
          else if (event.kind === 'api_error') apiError = event.code
          else if (event.kind === 'result') result = event
        }
      }
      const { code, error } = await exited
      if (turn.signal.aborted) throw new Error('Stopped')
      if (error?.code === 'ENOENT') {
        throw new AgentError(
          'no_cli',
          'Claude Code could not be started. Reinstall it, then try again.'
        )
      }
      if (error) throw new AgentError('other', `Claude Code could not be started: ${error.message}`)

      const text = result?.text || stderr.trim() || `Claude Code stopped with exit code ${code}.`
      if (result?.isError || !result || code !== 0) {
        if (
          (apiError && LOGIN_ERRORS.has(apiError)) ||
          /\/login|not logged in|log ?in again/i.test(text)
        ) {
          throw new AgentError(
            'cli_login',
            'Claude Code is not logged in. Open a terminal, run claude and log in, then try again.'
          )
        }
        throw new AgentError('api', text)
      }
      const session = { id: sessionId, answered: lastUser.id }
      if (this.o.chats) this.o.chats.setCli(turn.sessionId, session)
      else this.saveSession(turn.account?.id ?? null, session)
    } finally {
      stopListening()
      turn.signal.removeEventListener('abort', onAbort)
    }
  }

  /**
   * The CLI session an account's conversation is in (OP-61), so accounts never share one. Before
   * an account has its own, the one from before accounts is tried: the run() check that its last
   * answered message is in this history keeps it to the account the old chat moved to.
   */
  private session(account: string | null): CliSession | null {
    const read = (key: string): CliSession | null => {
      const value = this.o.settings.get(key) as Partial<CliSession> | null
      return value && typeof value.id === 'string' && typeof value.answered === 'string'
        ? { id: value.id, answered: value.answered }
        : null
    }
    return (account && read(sessionKey(account))) || read(SESSION_SETTING)
  }

  private saveSession(account: string | null, session: CliSession): void {
    this.o.settings.set(
      account ? sessionKey(account) : SESSION_SETTING,
      session as unknown as JsonValue
    )
  }
}
