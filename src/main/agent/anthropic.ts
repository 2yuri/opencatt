import Anthropic from '@anthropic-ai/sdk'
import type { ChatMessage } from '@shared/api'
import type { AgentConfig } from './config'
import { AgentError, type AgentRunner, type AgentTurn } from './session'
import { parseToolResult, toolNote } from '@shared/toolResult'
import {
  imagesOf,
  messagesWithImages,
  MAX_HISTORY_IMAGES,
  noImages,
  type ImageLoader
} from './images'
import {
  DEFAULT_WRITING,
  accountNote,
  basePrompt,
  attachmentNote,
  modeNote,
  when,
  zoneNote
} from './prompt'
import { callTool, type PostTool } from './tools'

type Params = Anthropic.Beta.Messages.MessageCreateParamsStreaming
type Message = Anthropic.Beta.Messages.BetaMessage
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam
type ContentBlock = Anthropic.Beta.Messages.BetaContentBlock
type StreamEvent = Anthropic.Beta.Messages.BetaRawMessageStreamEvent

/** The slice of the SDK the runner uses, so tests can hand it a fake. */
export interface ModelClient {
  stream(
    params: Params,
    options: { signal: AbortSignal }
  ): AsyncIterable<StreamEvent> & { finalMessage(): Promise<Message> }
  /** Throws the SDK's error when the key is refused. */
  check(model: string): Promise<void>
}

export function anthropicClient(apiKey: string): ModelClient {
  const client = new Anthropic({ apiKey })
  return {
    stream: (params, options) => client.beta.messages.stream(params, options),
    check: async (model) => {
      await client.models.retrieve(model)
    }
  }
}

/** Tool calls in one turn before we stop, so a confused model can't loop on the user's key. */
const MAX_STEPS = 12
const MAX_TOKENS = 16_000

/** Only Opus 5 is documented for fallbacks: "default". */
const takesFallbacks = (model: string): boolean => model === 'claude-opus-5'
const takesAdaptiveThinking = (model: string): boolean =>
  model === 'claude-opus-5' || model === 'claude-sonnet-5'

/**
 * The saved chat as the model's history. Built only from saved values, so every earlier turn
 * reads the same each time it is sent and stays in Anthropic's cache: user messages carry the
 * time they were sent, and tool notes name the posts they touched but not their live state,
 * which would change under the cache. The agent calls list_posts when it needs that.
 */
export function historyFor(
  history: ChatMessage[],
  now: Date = new Date(),
  images: ImageLoader = noImages
): MessageParam[] {
  type Block =
    Anthropic.Beta.Messages.BetaTextBlockParam | Anthropic.Beta.Messages.BetaImageBlockParam
  const turns: { role: 'user' | 'assistant'; content: Block[] }[] = []
  const add = (role: 'user' | 'assistant', block: Block): void => {
    const last = turns.at(-1)
    if (last?.role === role) last.content.push(block)
    else turns.push({ role, content: [block] })
  }
  const push = (role: 'user' | 'assistant', text: string): void => add(role, { type: 'text', text })
  const withImages = messagesWithImages(history, MAX_HISTORY_IMAGES)

  for (const message of history) {
    if (message.role === 'user') {
      // Images first, the way Anthropic suggests, then what the user said about them.
      for (const image of withImages.has(message.id) ? imagesOf(message, images) : []) {
        add('user', {
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.data }
        })
      }
      // Video mode's pre-prompt goes before the user's words, as one message (OP-81).
      const said = [message.preface, message.content].filter(Boolean).join('\n\n')
      if (said) push('user', said)
      const mode = modeNote(message)
      if (mode) push('user', mode)
      const attached = attachmentNote(message)
      if (attached) push('user', attached)
      push('user', `(Sent ${when(new Date(message.createdAt))}.)`)
    } else if (message.role === 'assistant') {
      push('assistant', message.content)
    } else {
      const result = parseToolResult(message.content)
      if (result) push('assistant', toolNote(result))
    }
  }

  // The API needs the history to end with the user. After an error the last saved message can
  // be the assistant's partial reply, so ask it to carry on.
  if (turns.at(-1)?.role === 'assistant') {
    push('user', 'Please continue.')
    push('user', `(Sent ${when(now)}.)`)
  }
  return turns
}

/**
 * After a mid-answer fallback to another model, blocks the first model produced before the last
 * fallback marker can't be sent back, except its text.
 */
function echoable(content: ContentBlock[]): ContentBlock[] {
  const last = content.findLastIndex((b) => b.type === 'fallback')
  if (last < 0) return content
  return content.filter((b, i) => i > last || b.type === 'text')
}

function toAgentError(err: unknown): unknown {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AgentError('bad_key', 'Anthropic refused this API key.')
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AgentError('bad_key', `Anthropic refused the request: ${err.message}`)
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AgentError(
      'api',
      'Anthropic says you are over your rate limit. Try again in a minute.'
    )
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AgentError('network', 'Could not reach Anthropic.')
  }
  if (err instanceof Anthropic.APIError) {
    return new AgentError('api', `Anthropic returned an error: ${err.message}`)
  }
  return err
}

export class AnthropicRunner implements AgentRunner {
  private client: { key: string; client: ModelClient } | null = null

  constructor(
    private readonly config: AgentConfig,
    private readonly tools: PostTool[],
    private readonly now: () => Date = () => new Date(),
    private readonly connect: (key: string) => ModelClient = anthropicClient,
    private readonly images: ImageLoader = noImages
  ) {}

  /** Checks a key before it is saved. */
  async checkKey(key: string): Promise<void> {
    try {
      await this.connect(key).check(this.config.model())
    } catch (err) {
      throw toAgentError(err)
    }
  }

  async run(turn: AgentTurn): Promise<void> {
    const key = this.config.key()
    if (!key) throw new AgentError('no_key', 'Add your Anthropic API key to use the agent.')
    if (this.client?.key !== key) this.client = { key, client: this.connect(key) }
    const client = this.client.client

    const model = this.config.model()
    const messages: MessageParam[] = historyFor(turn.history, this.now(), this.images)
    const tools: Anthropic.Beta.Messages.BetaTool[] = this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: { ...t.inputSchema },
      // Inputs are validated by the tool itself, so streaming them early is safe.
      eager_input_streaming: true
    }))
    const params = {
      model,
      max_tokens: MAX_TOKENS,
      system: [
        { type: 'text' as const, text: basePrompt(turn.writing ?? DEFAULT_WRITING) },
        // A fixed read point for the expensive shared part, whatever happens in messages.
        { type: 'text' as const, text: zoneNote(), cache_control: { type: 'ephemeral' as const } },
        // After the shared part, so switching accounts keeps it. The voice changes only when the
        // user saves it, so the account's block gets a read point of its own (OP-74).
        ...(turn.account
          ? [
              {
                type: 'text' as const,
                text: accountNote(turn.account),
                cache_control: { type: 'ephemeral' as const }
              }
            ]
          : [])
      ],
      tools,
      cache_control: { type: 'ephemeral' as const },
      ...(takesAdaptiveThinking(model) ? { thinking: { type: 'adaptive' as const } } : {}),
      ...(takesFallbacks(model)
        ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
        : {})
    }

    for (let step = 0; step < MAX_STEPS; step++) {
      let message: Message
      try {
        const stream = client.stream({ ...params, messages, stream: true }, { signal: turn.signal })
        for await (const event of stream) {
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            turn.tool(event.content_block.name)
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            turn.text(event.delta.text)
          }
        }
        message = await stream.finalMessage()
      } catch (err) {
        if (turn.signal.aborted) throw err
        throw toAgentError(err)
      }

      if (message.stop_reason === 'refusal') {
        throw new AgentError('api', 'The model declined this request. Try rephrasing it.')
      }
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: echoable(message.content) })
        continue
      }
      const calls = message.content.filter(
        (b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use'
      )
      if (calls.length === 0) return
      if (message.stop_reason === 'max_tokens') {
        throw new AgentError('api', 'The reply was cut off before a tool call finished.')
      }

      messages.push({ role: 'assistant', content: echoable(message.content) })
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = []
      for (const call of calls) {
        const outcome = await callTool(this.tools, call.name, call.input)
        if (outcome.result) turn.toolResult(outcome.result)
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: outcome.image
            ? [
                { type: 'text', text: outcome.content },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: outcome.image.mediaType,
                    data: outcome.image.data
                  }
                }
              ]
            : outcome.content,
          ...(outcome.isError ? { is_error: true } : {})
        })
      }
      // All results for one assistant turn go back in one user message.
      messages.push({ role: 'user', content: results })
      if (turn.signal.aborted) return
    }
    throw new AgentError('api', `The agent stopped after ${MAX_STEPS} tool calls in one reply.`)
  }
}
