import { randomUUID } from 'node:crypto'
import type { ChatSession, JsonValue } from '@shared/api'
import type { Database } from './database'
import type { SettingsStore } from './settings'

interface SessionRow {
  id: string
  account_id: string | null
  title: string
  title_set: number
  created_at: string
  updated_at: string
  cli_session_id: string | null
  archived: number
}

/** A Claude Code session a chat is in, and the last message it answered (OP-28). */
export interface CliSession {
  id: string
  answered: string
}

export const NEW_CHAT_TITLE = 'New chat'
const MAX_TITLE = 80
const AUTO_TITLE = 48

/** The chat's title from the first thing the user wrote: its first line, cut on a word. */
export function titleFrom(text: string): string | null {
  const line = text.trim().split('\n')[0]!.replace(/\s+/g, ' ').trim()
  if (!line) return null
  if (line.length <= AUTO_TITLE) return line
  const cut = line.slice(0, AUTO_TITLE)
  const space = cut.lastIndexOf(' ')
  return `${(space > AUTO_TITLE / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:!?-]+$/, '')}…`
}

const activeKey = (account: string | null): string => `chat.activeSession.${account ?? '-'}`

/**
 * An account's chats (OP-94): each has its own messages and its own Claude Code session, so their
 * contexts never mix. One is active per account, and there is always at least one.
 */
export class ChatSessionStore {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** An account's chats, most recently used first; null is the one from before any account. */
  list(account: string | null): ChatSession[] {
    const active = this.active(account)
    return this.rows(account).map((row) => this.toSession(row, active))
  }

  get(id: string): ChatSession | null {
    const row = this.row(id)
    return row ? this.toSession(row, this.activeId(row.account_id)) : null
  }

  /** The account's active chat, made when it has none. */
  active(account: string | null): string {
    const saved = this.activeId(account)
    if (saved) return saved
    const latest = this.rows(account)[0]
    if (latest) {
      this.settings.set(activeKey(account), latest.id)
      return latest.id
    }
    return this.create(account).id
  }

  /** A new, empty chat on the account, which becomes the active one. */
  create(account: string | null): ChatSession {
    const id = randomUUID()
    const at = this.now().toISOString()
    this.db
      .prepare(
        `INSERT INTO chat_sessions (id, account_id, title, title_set, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`
      )
      .run(id, account, NEW_CHAT_TITLE, at, at)
    this.settings.set(activeKey(account), id)
    return this.get(id)!
  }

  rename(id: string, title: string): ChatSession {
    const row = this.mustRow(id)
    const value = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : ''
    if (!value) throw new Error('Give the chat a name.')
    if (value.length > MAX_TITLE) throw new Error(`Keep the name under ${MAX_TITLE} characters.`)
    this.db.prepare('UPDATE chat_sessions SET title = ?, title_set = 1 WHERE id = ?').run(value, id)
    return this.toSession({ ...row, title: value, title_set: 1 }, this.activeId(row.account_id))
  }

  /**
   * Removes a chat's row; its messages are the caller's to clear first. When it was the active
   * one, the most recent other chat takes over, or a new one when it was the last.
   */
  delete(id: string): string | null {
    const row = this.mustRow(id)
    this.db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id)
    if (this.activeId(row.account_id) === null) this.active(row.account_id)
    return row.account_id
  }

  setActive(id: string): ChatSession {
    const row = this.mustRow(id)
    this.settings.set(activeKey(row.account_id), id)
    return this.toSession(row, id)
  }

  /** A message was saved in the chat: it moves to the top, and the first one names it. */
  touch(id: string, userText?: string): void {
    const at = this.now().toISOString()
    const title = userText === undefined ? null : titleFrom(userText)
    if (title) {
      this.db
        .prepare(
          `UPDATE chat_sessions SET updated_at = ?,
             title = CASE title_set WHEN 0 THEN ? ELSE title END, title_set = 1
           WHERE id = ?`
        )
        .run(at, title, id)
    } else {
      this.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(at, id)
    }
  }

  /** The Claude Code session the chat is in, if any. */
  cli(id: string): CliSession | null {
    const value = this.row(id)?.cli_session_id
    if (!value) return null
    try {
      const parsed = JSON.parse(value) as Partial<CliSession>
      return typeof parsed.id === 'string' && typeof parsed.answered === 'string'
        ? { id: parsed.id, answered: parsed.answered }
        : null
    } catch {
      return null
    }
  }

  setCli(id: string, session: CliSession): void {
    this.db
      .prepare('UPDATE chat_sessions SET cli_session_id = ? WHERE id = ?')
      .run(JSON.stringify(session), id)
  }

  /** Gives the chats from before any account to the first one connected, like their messages. */
  assignAccount(accountId: string): void {
    const moved = this.db
      .prepare('UPDATE chat_sessions SET account_id = ? WHERE account_id IS NULL')
      .run(accountId).changes
    if (Number(moved) === 0) return
    const before = this.settings.get(activeKey(null))
    if (typeof before === 'string' && this.activeId(accountId) === null) {
      this.settings.set(activeKey(accountId), before)
    }
    this.settings.set(activeKey(null), null as JsonValue)
  }

  private activeId(account: string | null): string | null {
    const saved = this.settings.get(activeKey(account))
    if (typeof saved !== 'string') return null
    const row = this.row(saved)
    return row && row.account_id === account ? saved : null
  }

  private rows(account: string | null): SessionRow[] {
    return this.db
      .prepare(
        `SELECT * FROM chat_sessions WHERE account_id IS ? ORDER BY updated_at DESC, rowid DESC`
      )
      .all(account) as unknown as SessionRow[]
  }

  private row(id: string): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as
      SessionRow | undefined
  }

  private mustRow(id: string): SessionRow {
    const row = this.row(String(id))
    if (!row) throw new Error('That chat no longer exists.')
    return row
  }

  private toSession(row: SessionRow, active: string | null): ChatSession {
    return {
      id: row.id,
      accountId: row.account_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archived: row.archived === 1,
      active: row.id === active,
      streaming: false
    }
  }
}
