import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AgentSession, TurnScope, type AgentTurn, type TurnAccount } from '../agent/session'
import { ChatStore } from './chat'
import { ChatSessionStore, NEW_CHAT_TITLE, titleFrom } from './chatSessions'
import { openDatabase } from './database'
import { migrate } from './migrations'
import { SettingsStore } from './settings'

function setup() {
  const db = openDatabase(':memory:')
  let t = Date.parse('2026-09-28T10:00:00Z')
  const now = (): Date => new Date((t += 1000))
  const settings = new SettingsStore(db)
  return {
    db,
    settings,
    chat: new ChatStore(db, now),
    chats: new ChatSessionStore(db, settings, now)
  }
}

describe('migration 15: chats (OP-94)', () => {
  it("moves each account's messages into one chat called Chat, with its Claude Code session", () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, 14)
    const add = (id: string, account: string | null, at: string): void => {
      db.prepare(
        `INSERT INTO chat_messages (id, role, content, created_at, account_id) VALUES (?, 'user', ?, ?, ?)`
      ).run(id, id, at, account)
    }
    add('a1', 'A', '2026-09-01T10:00:00Z')
    add('a2', 'A', '2026-09-02T10:00:00Z')
    add('b1', 'B', '2026-09-03T10:00:00Z')
    add('n1', null, '2026-08-30T10:00:00Z')
    const set = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    set.run('agent.cliSession.A', JSON.stringify({ id: 'cli-A', answered: 'a2' }))
    set.run('agent.cliSession', JSON.stringify({ id: 'cli-old', answered: 'n1' }))

    migrate(db)

    const sessions = db.prepare('SELECT * FROM chat_sessions ORDER BY account_id').all() as {
      id: string
      account_id: string | null
      title: string
      cli_session_id: string
      created_at: string
      updated_at: string
    }[]
    expect(sessions.map((s) => [s.account_id, s.title])).toEqual([
      [null, 'Chat'],
      ['A', 'Chat'],
      ['B', 'Chat']
    ])
    const a = sessions.find((s) => s.account_id === 'A')!
    expect(JSON.parse(a.cli_session_id)).toEqual({ id: 'cli-A', answered: 'a2' })
    expect([a.created_at, a.updated_at]).toEqual(['2026-09-01T10:00:00Z', '2026-09-02T10:00:00Z'])
    // B never had its own CLI session; the one from before accounts is kept for the runner to check.
    expect(JSON.parse(sessions.find((s) => s.account_id === 'B')!.cli_session_id).id).toBe(
      'cli-old'
    )
    const bySession = db.prepare('SELECT id, session_id FROM chat_messages ORDER BY id').all() as {
      id: string
      session_id: string
    }[]
    expect(bySession.filter((m) => m.session_id === a.id).map((m) => m.id)).toEqual(['a1', 'a2'])
    expect(bySession.every((m) => m.session_id)).toBe(true)
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('ChatSessionStore (OP-94)', () => {
  it('always has an active chat per account, and a new one becomes it', () => {
    const { chats } = setup()
    const first = chats.active('A')
    expect(chats.list('A')).toMatchObject([{ id: first, title: NEW_CHAT_TITLE, active: true }])
    const second = chats.create('A')
    expect(chats.active('A')).toBe(second.id)
    expect(chats.list('A').map((c) => [c.id, c.active])).toEqual([
      [second.id, true],
      [first, false]
    ])
    expect(chats.list('B')).toHaveLength(1)
  })

  it('names a chat from its first message, keeps a rename, and refuses an empty one', () => {
    const { chats } = setup()
    const id = chats.active('A')
    chats.touch(id, 'Schedule three posts about the launch of our week view next Monday please')
    expect(chats.get(id)!.title).toBe('Schedule three posts about the launch of our…')
    chats.touch(id, 'Something else')
    expect(chats.get(id)!.title).toBe('Schedule three posts about the launch of our…')
    expect(chats.rename(id, '  Launch  week ').title).toBe('Launch week')
    expect(() => chats.rename(id, '   ')).toThrow('Give the chat a name.')
    expect(titleFrom('   ')).toBeNull()
  })

  it('moves to another chat when the active one is deleted, and makes one when it was the last', () => {
    const { chats } = setup()
    const a = chats.active('A')
    const b = chats.create('A').id
    chats.delete(b)
    expect(chats.active('A')).toBe(a)
    chats.delete(a)
    const fresh = chats.list('A')
    expect(fresh).toHaveLength(1)
    expect(fresh[0]!.id).not.toBe(a)
  })

  it('gives the chats from before any account to the first one, active one included', () => {
    const { chats } = setup()
    const early = chats.active(null)
    chats.assignAccount('A')
    expect(chats.active('A')).toBe(early)
    expect(chats.get(early)!.accountId).toBe('A')
  })
})

describe('AgentSession with chats (OP-94)', () => {
  it('keeps chats apart, and a turn saves in the chat it started in when the user switches', async () => {
    const { chat, chats } = setup()
    const scope = new TurnScope()
    const account: TurnAccount = { id: 'A', handle: 'alpha', name: null }
    const turns: AgentTurn[] = []
    let release: () => void = () => {}
    const changed: (string | null)[] = []
    const session = new AgentSession(
      chat,
      {
        async run(turn) {
          turns.push(turn)
          await new Promise<void>((r) => (release = r))
          turn.text(`Reply in ${turn.sessionId}`)
        }
      },
      () => {},
      () => null,
      () => {},
      () => account,
      scope,
      undefined,
      undefined,
      chats,
      (accountId) => changed.push(accountId)
    )

    const first = session.send('Plan the launch')
    expect(scope.session).toBe(first.sessionId)
    expect(session.chatList().find((c) => c.id === first.sessionId)!.streaming).toBe(true)
    const other = session.newChat()
    release()
    await session.idle

    expect(chat.list(first.sessionId!).map((m) => m.content)).toEqual([
      'Plan the launch',
      `Reply in ${first.sessionId}`
    ])
    expect(session.history()).toEqual([])
    expect(session.chatList().some((c) => c.streaming)).toBe(false)
    expect(chats.get(first.sessionId!)!.title).toBe('Plan the launch')

    const second = session.send('Something unrelated')
    release()
    await session.idle
    expect(second.sessionId).toBe(other.id)
    expect(turns[1]!.history.map((m) => m.content)).toEqual(['Something unrelated'])
    expect(changed.every((id) => id === 'A')).toBe(true)

    session.deleteChat(first.sessionId!)
    expect(chat.list(first.sessionId!)).toEqual([])
    expect(chats.get(first.sessionId!)).toBeNull()
  })
})
