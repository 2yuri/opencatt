import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@shared/api'
import { ChatStore } from '../db'
import { openDatabase } from '../db/database'
import { AgentError, AgentSession, TurnScope, type AgentRunner, type TurnAccount } from './session'

function setup(runner: AgentRunner): {
  session: AgentSession
  chat: ChatStore
  events: AgentEvent[]
} {
  const chat = new ChatStore(openDatabase(':memory:'))
  const events: AgentEvent[] = []
  const session = new AgentSession(chat, runner, (e) => events.push(e))
  return { session, chat, events }
}

const roles = (chat: ChatStore): [string, string][] => chat.list().map((m) => [m.role, m.content])

describe('AgentSession', () => {
  it('saves the user message, streams the reply, then saves it', async () => {
    const { session, chat, events } = setup({
      async run(turn) {
        turn.text('Hel')
        turn.text('lo')
      }
    })

    const { turnId } = session.send('  Hi  ')
    await session.idle

    expect(roles(chat)).toEqual([
      ['user', 'Hi'],
      ['assistant', 'Hello']
    ])
    expect(events.map((e) => e.type)).toEqual(['message', 'text', 'text', 'message', 'done'])
    expect(events.every((e) => e.turnId === turnId)).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'done', turnId, accountId: null, stopped: false })
  })

  it('saves who answered on the replies only, as it was when the turn started', async () => {
    const chat = new ChatStore(openDatabase(':memory:'))
    let via = 'Claude Code · Opus 5'
    const session = new AgentSession(
      chat,
      {
        async run(turn) {
          via = 'API key · Opus 5'
          turn.text('Done.')
        }
      },
      () => undefined,
      () => via
    )
    session.send('Schedule it')
    await session.idle
    expect(chat.list().map((m) => [m.role, m.via])).toEqual([
      ['user', null],
      ['assistant', 'Claude Code · Opus 5']
    ])
  })

  it('keeps text and tool results in the order they happened', async () => {
    const { session, chat } = setup({
      async run(turn) {
        turn.text('On it.')
        turn.tool('create_post')
        turn.toolResult({ kind: 'posts', action: 'created', postIds: ['p1'] })
        turn.text('Done.')
      }
    })

    session.send('Schedule one')
    await session.idle

    expect(roles(chat)).toEqual([
      ['user', 'Schedule one'],
      ['assistant', 'On it.'],
      ['tool', '{"kind":"posts","action":"created","postIds":["p1"]}'],
      ['assistant', 'Done.']
    ])
  })

  it('refuses a second message while a turn runs, and an empty one', async () => {
    let release!: () => void
    const { session } = setup({
      run: () => new Promise<void>((resolve) => (release = resolve))
    })

    expect(() => session.send('   ')).toThrow('Type a message first')
    session.send('one')
    expect(() => session.send('two')).toThrow('still answering')
    release()
    await session.idle
    expect(() => session.send('two')).not.toThrow()
  })

  it('on cancel keeps what was streamed and reports stopped', async () => {
    const { session, chat, events } = setup({
      run: (turn) =>
        new Promise<void>((_resolve, reject) => {
          turn.text('Half a')
          turn.signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
    })

    const { turnId } = session.send('Go')
    session.cancel()
    await session.idle

    expect(roles(chat)).toEqual([
      ['user', 'Go'],
      ['assistant', 'Half a']
    ])
    expect(events.at(-1)).toEqual({ type: 'done', turnId, accountId: null, stopped: true })
  })

  it('reports errors with their code, and retry runs again without a new user message', async () => {
    let calls = 0
    const { session, chat, events } = setup({
      async run(turn) {
        calls++
        if (calls === 1) throw new AgentError('no_key', 'Add your Anthropic key')
        if (calls === 2) throw new Error('boom')
        turn.text('Fine now')
      }
    })

    const first = session.send('Hi')
    await session.idle
    expect(events.at(-1)).toEqual({
      type: 'error',
      turnId: first.turnId,
      accountId: null,
      code: 'no_key',
      message: 'Add your Anthropic key'
    })

    session.retry()
    await session.idle
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'other', message: 'boom' })

    session.retry()
    await session.idle
    expect(roles(chat)).toEqual([
      ['user', 'Hi'],
      ['assistant', 'Fine now']
    ])
  })

  it('refuses to clear the history while a turn runs', async () => {
    let release!: () => void
    const { session, chat } = setup({
      run: () => new Promise<void>((resolve) => (release = resolve))
    })
    session.send('one')
    expect(() => session.clear()).toThrow('still answering')
    release()
    await session.idle
    session.clear()
    expect(chat.list()).toEqual([])
  })

  it('saves nothing after close', async () => {
    const { session, chat } = setup({
      run: (turn) =>
        new Promise<void>((_resolve, reject) => {
          turn.text('partial')
          turn.signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
    })

    session.send('Go')
    session.close()
    await session.idle

    expect(roles(chat)).toEqual([['user', 'Go']])
    expect(() => session.send('again')).toThrow('shut down')
  })
})

describe('AgentSession media', () => {
  it('sends files without text, and clearing hands their ids to discard', async () => {
    const { join } = await import('node:path')
    const { MediaStore } = await import('../media/store')
    const { fakeMedia, tempDir } = await import('../media/testFiles')
    const db = openDatabase(':memory:')
    const media = new MediaStore(db, join(tempDir(), 'media'))
    const id = media.import(fakeMedia(tempDir('opencat-src-'), 'a.png')).id
    const chat = new ChatStore(db)
    const discarded: string[] = []
    const session = new AgentSession(
      chat,
      { async run() {} },
      () => {},
      () => null,
      (ids) => discarded.push(...ids)
    )

    session.send('   ', [id])
    await session.idle
    expect(chat.list()[0]).toMatchObject({ role: 'user', content: '' })
    expect(chat.list()[0].media.map((m) => m.id)).toEqual([id])

    session.clear()
    expect(discarded).toEqual([id])
  })
})

describe('AgentSession per account', () => {
  it('binds a turn to the account active when it started, even if the user switches mid-turn', async () => {
    const chat = new ChatStore(openDatabase(':memory:'))
    const scope = new TurnScope()
    let active: TurnAccount | null = { id: 'A', handle: 'alpha', name: 'Alpha' }
    let release: () => void = () => {}
    const seen: { account: string | null; scope: string | null; history: string[] }[] = []
    const events: AgentEvent[] = []
    const session = new AgentSession(
      chat,
      {
        async run(turn) {
          seen.push({
            account: turn.account?.id ?? null,
            scope: scope.current?.id ?? null,
            history: turn.history.map((m) => m.content)
          })
          await new Promise<void>((r) => (release = r))
          turn.text('Done in A')
        }
      },
      (e) => events.push(e),
      () => null,
      () => {},
      () => active,
      scope
    )
    chat.append({ role: 'user', content: 'Old B message', accountId: 'B' })

    const started = session.send('Write for alpha')
    expect(started.accountId).toBe('A')
    active = { id: 'B', handle: 'beta', name: null }
    release()
    await session.idle

    expect(seen).toEqual([{ account: 'A', scope: 'A', history: ['Write for alpha'] }])
    expect(scope.current).toBeNull()
    expect(chat.list('A').map((m) => [m.role, m.content])).toEqual([
      ['user', 'Write for alpha'],
      ['assistant', 'Done in A']
    ])
    expect(events.every((e) => e.accountId === 'A')).toBe(true)
    expect(session.history().map((m) => m.content)).toEqual(['Old B message'])
  })
})

describe('AgentSession composer mode', () => {
  it('saves the mode on the user message, and a retry keeps it in the history', async () => {
    const seen: string[] = []
    const { session, chat } = setup({
      async run(turn) {
        seen.push(turn.history.filter((m) => m.role === 'user').at(-1)!.mode)
        if (seen.length === 1) throw new AgentError('network', 'down')
      }
    })
    session.send('Our launch', [], 'image')
    await session.idle
    session.retry()
    await session.idle
    expect(chat.list()[0].mode).toBe('image')
    expect(seen).toEqual(['image', 'image'])
  })
})

describe('AgentSession preface', () => {
  it('saves the preface for the mode and passes the picker length', async () => {
    const chat = new ChatStore(openDatabase(':memory:'))
    const calls: unknown[] = []
    const session = new AgentSession(
      chat,
      { async run() {} },
      () => {},
      () => null,
      () => {},
      () => null,
      new TurnScope(),
      (mode, text, seconds) => {
        calls.push([mode, text, seconds])
        return mode === 'video' ? `${seconds}-second showreel` : null
      }
    )
    session.send('our launch', [], 'video', 20)
    await session.idle
    session.send('just text')
    await session.idle
    expect(calls).toEqual([
      ['video', 'our launch', 20],
      ['text', 'just text', undefined]
    ])
    expect(
      chat
        .list()
        .filter((m) => m.role === 'user')
        .map((m) => [m.content, m.preface])
    ).toEqual([
      ['our launch', '20-second showreel'],
      ['just text', null]
    ])
  })
})

describe('files attached to the turn (OP-89)', () => {
  it("puts the answered message's media ids on the scope while the turn runs, retry included", async () => {
    const { join } = await import('node:path')
    const { MediaStore } = await import('../media/store')
    const { fakeMedia, tempDir } = await import('../media/testFiles')
    const db = openDatabase(':memory:')
    const media = new MediaStore(db, join(tempDir(), 'media'))
    const id = media.import(fakeMedia(tempDir('opencat-src-'), 'logo.png')).id
    const scope = new TurnScope()
    const seen: (readonly string[])[] = []
    const session = new AgentSession(
      new ChatStore(db),
      {
        async run() {
          seen.push(scope.attached)
        }
      },
      () => {},
      () => null,
      () => {},
      () => null,
      scope
    )

    session.send('Post this', [id])
    await session.idle
    session.retry()
    await session.idle
    session.send('Now one without a file')
    await session.idle

    expect(seen).toEqual([[id], [id], []])
    expect(scope.attached).toEqual([])
  })
})
