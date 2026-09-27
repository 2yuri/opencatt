import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import type { AgentEvent, ChatMessage } from '@shared/api'
import { ChatStore, PostsService, SettingsStore } from '../db'
import { openDatabase } from '../db/database'
import { AnthropicRunner, historyFor, type ModelClient } from './anthropic'
import { AgentConfig, type SecretStore } from './config'
import { AgentSession } from './session'
import { postTools } from './tools'

type Message = Anthropic.Beta.Messages.BetaMessage
type Block = Message['content'][number]
type Params = Parameters<ModelClient['stream']>[0]

const NOW = new Date('2026-09-26T20:00:00Z')

function message(content: Block[], stop: Message['stop_reason'] = 'end_turn'): Message {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content,
    stop_reason: stop
  } as Message
}
const text = (t: string): Block => ({ type: 'text', text: t, citations: null }) as Block
const toolUse = (id: string, name: string, input: unknown): Block =>
  ({ type: 'tool_use', id, name, input }) as Block

class MemorySecrets implements SecretStore {
  values = new Map<string, unknown>()
  available = true
  isAvailable = (): boolean => this.available
  get = <T>(name: string): T | null => (this.values.get(name) as T) ?? null
  set = (name: string, value: unknown): void => void this.values.set(name, value)
  delete = (name: string): void => void this.values.delete(name)
}

/** A client that answers each request with the next scripted message, streamed as events. */
function fakeClient(script: (Message | Error)[]): ModelClient & { requests: Params[] } {
  const requests: Params[] = []
  return {
    requests,
    check: async () => {},
    stream(params, { signal }) {
      requests.push(structuredClone(params))
      const next = script.shift()
      if (!next) throw new Error('script ran out')
      return {
        async *[Symbol.asyncIterator]() {
          if (next instanceof Error) throw next
          for (const block of next.content) {
            if (signal.aborted) throw new Anthropic.APIUserAbortError()
            if (block.type === 'text') {
              yield { type: 'content_block_start', index: 0, content_block: { ...block, text: '' } }
              yield {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: block.text }
              }
            } else if (block.type === 'tool_use') {
              yield { type: 'content_block_start', index: 0, content_block: block }
            }
          }
        },
        finalMessage: async () => {
          if (next instanceof Error) throw next
          return next
        }
      } as ReturnType<ModelClient['stream']>
    }
  }
}

function setup(
  script: (Message | Error)[],
  key: string | null = 'sk-test',
  onEvent: (e: AgentEvent, session: AgentSession) => void = () => {}
) {
  const db = openDatabase(':memory:')
  const posts = new PostsService(db, () => NOW)
  const chat = new ChatStore(db, () => NOW)
  const secrets = new MemorySecrets()
  if (key) secrets.set('anthropic.apiKey', key)
  const config = new AgentConfig(secrets, new SettingsStore(db))
  const client = fakeClient(script)
  const runner = new AnthropicRunner(
    config,
    postTools(posts, () => NOW),
    () => NOW,
    () => client
  )
  const events: AgentEvent[] = []
  const session: AgentSession = new AgentSession(chat, runner, (e) => {
    events.push(e)
    onEvent(e, session)
  })
  return { posts, chat, client, config, events, session, runner }
}

describe('AnthropicRunner', () => {
  it('streams text and sends the model, tools and local time', async () => {
    const { client, chat, session } = setup([message([text('Hi there')])])
    session.send('Hello')
    await session.idle

    expect(chat.list().map((m) => [m.role, m.content])).toEqual([
      ['user', 'Hello'],
      ['assistant', 'Hi there']
    ])
    const req = client.requests[0]!
    expect(req.model).toBe('claude-opus-5')
    expect(req.tools?.map((t) => ('name' in t ? t.name : ''))).toEqual([
      'create_posts',
      'list_posts',
      'update_post',
      'reschedule_post',
      'delete_post'
    ])
    expect(JSON.stringify(req.system)).toContain("The user's time zone is Europe/Lisbon")
    expect(req.thinking).toEqual({ type: 'adaptive' })
    expect(req.fallbacks).toBe('default')
    expect(req.betas).toEqual(['server-side-fallback-2026-07-01'])
    expect(req.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: '(Sent Saturday 2026-09-26T21:00:00+01:00.)' }
        ]
      }
    ])
  })

  it('runs tool calls, returns every result in one message, and loops until done', async () => {
    const { client, chat, posts, session, events } = setup([
      message(
        [
          text('Scheduling.'),
          toolUse('t1', 'create_posts', {
            posts: [{ text: 'Launch!', scheduled_at: '2026-09-28T09:00:00+01:00' }]
          }),
          toolUse('t2', 'create_posts', {
            posts: [{ text: 'Late', scheduled_at: '2020-01-01T09:00:00Z' }]
          })
        ],
        'tool_use'
      ),
      message([text('Done: Monday at 09:00.')])
    ])
    session.send('Schedule a launch post for Monday 9am')
    await session.idle

    expect(posts.listByDay('2026-09-28').map((p) => p.text)).toEqual(['Launch!'])
    expect(events.some((e) => e.type === 'tool' && e.name === 'create_posts')).toBe(true)
    expect(chat.list().map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])

    const second = client.requests[1]!.messages
    const results = second.at(-1)!.content as Anthropic.Beta.Messages.BetaToolResultBlockParam[]
    expect(results.map((r) => [r.tool_use_id, r.is_error ?? false])).toEqual([
      ['t1', false],
      ['t2', true]
    ])
    expect(String(results[1]!.content)).toContain('in the past')
  })

  it('maps missing and refused keys, network and API errors', async () => {
    const noKey = setup([], null)
    noKey.session.send('Hi')
    await noKey.session.idle
    expect(noKey.events.at(-1)).toMatchObject({ type: 'error', code: 'no_key' })

    const cases: [Error, string][] = [
      [
        new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers()),
        'bad_key'
      ],
      [new Anthropic.APIConnectionError({ message: 'offline' }), 'network'],
      [new Anthropic.InternalServerError(500, undefined, 'boom', new Headers()), 'api']
    ]
    for (const [err, code] of cases) {
      const { session, events } = setup([err])
      session.send('Hi')
      await session.idle
      expect(events.at(-1)).toMatchObject({ type: 'error', code })
    }
  })

  it('reports a refusal instead of running its tools', async () => {
    const { session, events, posts } = setup([
      message([toolUse('t1', 'delete_post', { id: 'x' })], 'refusal')
    ])
    session.send('Hi')
    await session.idle
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'api' })
    expect(posts.listByDay('2026-09-28')).toEqual([])
  })

  it('stops when cancelled and keeps posts already created', async () => {
    const { session, events, posts, chat, client } = setup(
      [
        message(
          [
            toolUse('t1', 'create_posts', {
              posts: [{ text: 'Kept', scheduled_at: '2026-09-28T09:00:00+01:00' }]
            })
          ],
          'tool_use'
        ),
        message([text('never streamed')])
      ],
      'sk-test',
      // The user presses Stop as soon as the card appears.
      (e, s) => e.type === 'message' && e.message.role === 'tool' && s.cancel()
    )
    session.send('Go')
    await session.idle
    expect(posts.listByDay('2026-09-28').map((p) => p.text)).toEqual(['Kept'])
    expect(client.requests).toHaveLength(1)
    expect(chat.list().map((m) => m.role)).toEqual(['user', 'tool'])
    expect(events.at(-1)).toMatchObject({ type: 'done', stopped: true })
  })

  it('leaves out thinking and fallbacks for Haiku', async () => {
    const { client, config, session } = setup([message([text('ok')])])
    config.setModel('claude-haiku-4-5')
    session.send('Hi')
    await session.idle
    expect(client.requests[0]!.thinking).toBeUndefined()
    expect(client.requests[0]!.fallbacks).toBeUndefined()
  })

  it('drops pre-fallback tool calls and thinking when it echoes a turn back', async () => {
    const fallback = {
      type: 'fallback',
      from: { model: 'claude-opus-5' },
      to: { model: 'claude-opus-4-8' }
    } as unknown as Block
    const { client, session } = setup([
      message(
        [
          { type: 'thinking', thinking: '', signature: 's' } as Block,
          text('Part one. '),
          fallback,
          toolUse('t1', 'list_posts', { from: '2026-09-28', to: '2026-09-28' })
        ],
        'tool_use'
      ),
      message([text('ok')])
    ])
    session.send('Hi')
    await session.idle
    const echoed = client.requests[1]!.messages.at(-2)!.content as Block[]
    expect(echoed.map((b) => b.type)).toEqual(['text', 'tool_use'])
  })
})

describe('retry after an error that followed a tool call', () => {
  it('shows the model what already ran instead of an empty turn', async () => {
    const { session, client, posts } = setup([
      message(
        [
          toolUse('t1', 'create_posts', {
            posts: [{ text: 'Once', scheduled_at: '2026-09-28T09:00:00+01:00' }]
          })
        ],
        'tool_use'
      ),
      new Anthropic.InternalServerError(500, undefined, 'boom', new Headers()),
      message([text('All done.')])
    ])
    session.send('Schedule one post for Monday 9am')
    await session.idle
    session.retry()
    await session.idle

    const [post] = posts.listByDay('2026-09-28')
    const retried = client.requests[2]!.messages
    expect(retried.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(retried[1]!.content).toEqual([
      { type: 'text', text: `(Tool note, already done: created posts ${post!.id}.)` }
    ])
    expect(retried[2]!.content).toEqual([
      { type: 'text', text: 'Please continue.' },
      { type: 'text', text: '(Sent Saturday 2026-09-26T21:00:00+01:00.)' }
    ])
    expect(JSON.stringify(client.requests[2]!.system)).toContain('Never repeat them')
    expect(posts.listByDay('2026-09-28')).toHaveLength(1)
  })
})

describe('historyFor', () => {
  const at = (role: ChatMessage['role'], content: string, createdAt = NOW): ChatMessage => ({
    id: content,
    role,
    content,
    createdAt: createdAt.toISOString(),
    via: null,
    media: [],
    accountId: null,
    mode: 'text',
    preface: null
  })

  it('tells the model which media ids a user message carries', () => {
    const photo = {
      id: 'm1',
      kind: 'image' as const,
      mime: 'image/png',
      bytes: 10,
      width: 1200,
      height: 800,
      durationMs: null,
      alt: null,
      url: 'opencat-media://m1.png'
    }
    const [turn] = historyFor([{ ...at('user', ''), media: [photo] }])
    expect(turn.content).toEqual([
      {
        type: 'text',
        text: '(Attached: media id m1 (image 1200x800). These go on the post as they are. To show one inside an image or video you make, pass its id in assets and load it as asset://<media id>; never redraw it.)'
      },
      { type: 'text', text: '(Sent Saturday 2026-09-26T21:00:00+01:00.)' }
    ])
  })

  it('puts the images of a user message first, as the loader gives them', () => {
    const photo = {
      id: 'm1',
      kind: 'image' as const,
      mime: 'image/png',
      bytes: 10,
      width: 2000,
      height: 1000,
      durationMs: null,
      alt: null,
      url: 'opencat-media://m1.png'
    }
    const clip = { ...photo, id: 'v1', kind: 'video' as const, durationMs: 42_000 }
    const [turn] = historyFor([{ ...at('user', 'Use these'), media: [photo, clip] }], NOW, (m) => ({
      mediaType: 'image/jpeg',
      data: `small-${m.id}`
    }))
    expect(turn.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'small-m1' } },
      { type: 'text', text: 'Use these' },
      {
        type: 'text',
        text: '(Attached: media id m1 (image 2000x1000); media id v1 (video 2000x1000, 42 s). These go on the post as they are. To show one inside an image or video you make, pass its id in assets and load it as asset://<media id>; never redraw it.)'
      },
      { type: 'text', text: '(Sent Saturday 2026-09-26T21:00:00+01:00.)' }
    ])
  })

  it('resends images only for the newest messages, up to the cap', () => {
    const photo = (id: string) => ({
      id,
      kind: 'image' as const,
      mime: 'image/png',
      bytes: 10,
      width: 10,
      height: 10,
      durationMs: null,
      alt: null,
      url: `opencat-media://${id}.png`
    })
    const history = Array.from({ length: 12 }, (_, i) => ({
      ...at('user', `m${i}`),
      id: `m${i}`,
      media: [photo(`a${i}`), photo(`b${i}`)]
    }))
    const turns = historyFor(history, NOW, (m) => ({ mediaType: 'image/png', data: m.id }))
    const sent = turns.flatMap((t) =>
      (t.content as { type: string; source?: { data: string } }[])
        .filter((b) => b.type === 'image')
        .map((b) => b.source!.data)
    )
    expect(sent).toHaveLength(20)
    expect(sent).not.toContain('a1')
    expect(sent.slice(0, 2)).toEqual(['a2', 'b2'])
    expect(JSON.stringify(turns)).toContain('media id a0 (image 10x10)')
  })

  it('tells the model what the composer mode asked for', () => {
    const [image] = historyFor([{ ...at('user', 'Our 1.0 launch'), mode: 'image' }])
    expect(image.content).toEqual([
      { type: 'text', text: 'Our 1.0 launch' },
      {
        type: 'text',
        text: '(Mode: Generate image. Write the post, make one image for it with render_image and attach it to that post, next to any file the user attached unless they said to replace it.)'
      },
      { type: 'text', text: '(Sent Saturday 2026-09-26T21:00:00+01:00.)' }
    ])
    const [video] = historyFor([{ ...at('user', 'Teaser'), mode: 'video' }])
    expect(JSON.stringify(video.content)).toContain('render_video')
    const [text] = historyFor([at('user', 'Just words')])
    expect(JSON.stringify(text.content)).not.toContain('Mode:')
  })

  it('sends a preface and the user text as one message, preface first', () => {
    const [turn] = historyFor([
      { ...at('user', 'our 1.0 launch'), mode: 'video', preface: 'make a dynamic 15-second video.' }
    ])
    expect((turn.content[0] as { text: string }).text).toBe(
      'make a dynamic 15-second video.\n\nour 1.0 launch'
    )
  })

  it('stamps user messages with their sent time and ends with the user', () => {
    const history = historyFor(
      [
        at('user', 'Schedule it'),
        at('assistant', 'On it.'),
        at('tool', JSON.stringify({ kind: 'posts', action: 'created', postIds: ['p1', 'p2'] })),
        at('tool', 'not json')
      ],
      new Date('2026-10-26T09:00:00Z')
    )
    expect(history).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Schedule it' },
          { type: 'text', text: '(Sent Saturday 2026-09-26T21:00:00+01:00.)' }
        ]
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'On it.' },
          { type: 'text', text: '(Tool note, already done: created posts p1, p2.)' }
        ]
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Please continue.' },
          { type: 'text', text: '(Sent Monday 2026-10-26T09:00:00+00:00.)' }
        ]
      }
    ])
  })

  it('never changes an earlier turn, so the conversation stays one cached prefix', () => {
    const first = [at('user', 'One'), at('assistant', 'Done one.')]
    const second = [...first, at('user', 'Two', new Date('2026-09-26T21:30:00Z'))]
    const a = historyFor(first.slice(0, 1), new Date('2026-09-26T20:00:10Z'))
    const b = historyFor(second, new Date('2026-09-26T21:30:05Z'))
    expect(JSON.stringify(b.slice(0, a.length))).toBe(JSON.stringify(a))
  })
})

describe('request prefix across turns', () => {
  it('sends byte-identical tools and system on every turn, whatever the time', async () => {
    const { client, session } = setup([message([text('One.')]), message([text('Two.')])])
    session.send('First')
    await session.idle
    session.send('Second')
    await session.idle

    const [a, b] = client.requests
    expect(JSON.stringify(b!.tools)).toBe(JSON.stringify(a!.tools))
    expect(JSON.stringify(b!.system)).toBe(JSON.stringify(a!.system))
    expect(JSON.stringify(b!.messages[0])).toBe(JSON.stringify(a!.messages[0]))
  })

  it('sends fallbacks only to Opus 5, and adaptive thinking to Opus 5 and Sonnet 5', async () => {
    const seen: Record<string, [unknown, unknown, unknown]> = {}
    for (const model of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']) {
      const { client, config, session } = setup([message([text('ok')])])
      config.setModel(model)
      session.send('Hi')
      await session.idle
      const req = client.requests[0]!
      seen[model] = [req.thinking, req.fallbacks, req.betas]
    }
    expect(seen).toEqual({
      'claude-opus-5': [{ type: 'adaptive' }, 'default', ['server-side-fallback-2026-07-01']],
      'claude-sonnet-5': [{ type: 'adaptive' }, undefined, undefined],
      'claude-haiku-4-5': [undefined, undefined, undefined]
    })
  })
})

describe('writing guide and voice (OP-74)', () => {
  it("puts the user's guide in the shared block and the voice behind its own cache point", async () => {
    const { client, runner } = setup([message([text('ok')])])
    await runner.run({
      history: [
        {
          id: 'u1',
          turnId: 't1',
          role: 'user',
          content: 'Hi',
          via: null,
          media: [],
          createdAt: NOW.toISOString()
        } as unknown as ChatMessage
      ],
      account: {
        id: 'A',
        handle: 'alpha',
        name: null,
        voice: {
          description: 'lowercase, dry',
          examples: [],
          language: 'auto',
          emoji: false,
          hashtags: false,
          images: 'never'
        }
      },
      writing: 'Write like a pirate.',
      signal: new AbortController().signal,
      text: () => {},
      tool: () => {},
      toolResult: () => {}
    })

    const system = client.requests[0]!.system as { text: string; cache_control?: unknown }[]
    expect(system).toHaveLength(3)
    expect(system[0]!.text).toContain("You can't approve posts")
    expect(system[0]!.text).toContain('Write like a pirate.')
    expect(system[0]!.text).not.toContain('How to write for X')
    expect(system[1]!.cache_control).toEqual({ type: 'ephemeral' })
    expect(system[2]!.text).toContain('How its posts sound: lowercase, dry')
    expect(system[2]!.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('uses the built-in guide when none is given', async () => {
    const { client, session } = setup([message([text('ok')])])
    session.send('Hi')
    await session.idle
    expect(JSON.stringify(client.requests[0]!.system)).toContain('How to write for X')
  })
})
