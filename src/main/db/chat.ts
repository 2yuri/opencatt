import { randomUUID } from 'node:crypto'
import {
  COMPOSER_MODES,
  type ChatMessage,
  type ChatRole,
  type ComposerMode,
  type NewChatMessage,
  type PostMedia
} from '@shared/api'
import { parseToolResult } from '@shared/toolResult'
import { mediaFromRow, type MediaRow } from '../media/store'
import type { Database } from './database'

const ROLES: ChatRole[] = ['user', 'assistant', 'tool']

interface ChatRow {
  id: string
  role: ChatRole
  content: string
  created_at: string
  via: string | null
  media: string | null
  account_id: string | null
  mode: string | null
  preface: string | null
}

/**
 * Which rows an account's conversation covers: its own, plus any from before an account was
 * connected (none once the first account has taken them).
 */
function scope(account: string | null): { sql: string; params: string[] } {
  return account === null
    ? { sql: 'account_id IS NULL', params: [] }
    : { sql: '(account_id = ? OR account_id IS NULL)', params: [account] }
}

const modeOf = (value: string | null): ComposerMode =>
  COMPOSER_MODES.includes(value as ComposerMode) ? (value as ComposerMode) : 'text'

function idsOf(json: string | null): string[] {
  if (!json) return []
  try {
    const ids: unknown = JSON.parse(json)
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export class ChatStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** An account's conversation, oldest first; null is the one from before any account. */
  list(account: string | null = null): ChatMessage[] {
    const where = scope(account)
    const rows = this.db
      .prepare(`SELECT * FROM chat_messages WHERE ${where.sql} ORDER BY created_at, rowid`)
      .all(...where.params) as unknown as ChatRow[]
    const media = this.media(rows.flatMap((row) => idsOf(row.media)))
    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      createdAt: row.created_at,
      via: row.via,
      // A file the sweep or a clear already removed just drops out of the message.
      media: idsOf(row.media).flatMap((id) => media.get(id) ?? []),
      accountId: row.account_id,
      mode: modeOf(row.mode),
      preface: row.preface
    }))
  }

  /**
   * Media ids in an account's conversation, the user's attachments and the agent's renders: the
   * ones the agent may attach there. Left out, every account's, which the media sweep keeps while
   * the chat shows them.
   */
  mediaIds(account?: string | null): Set<string> {
    const where = account === undefined ? { sql: '1', params: [] } : scope(account)
    const attached = this.db
      .prepare(`SELECT media FROM chat_messages WHERE media IS NOT NULL AND ${where.sql}`)
      .all(...where.params) as unknown as { media: string }[]
    const tools = this.db
      .prepare(`SELECT content FROM chat_messages WHERE role = 'tool' AND ${where.sql}`)
      .all(...where.params) as unknown as { content: string }[]
    const rendered = tools.flatMap((row) => {
      const result = parseToolResult(row.content)
      return result?.kind === 'render' ? [result.mediaId] : []
    })
    return new Set([...attached.flatMap((row) => idsOf(row.media)), ...rendered])
  }

  /** Gives the conversation from before any account to the first one connected. */
  assignAccount(accountId: string): number {
    return Number(
      this.db
        .prepare('UPDATE chat_messages SET account_id = ? WHERE account_id IS NULL')
        .run(accountId).changes
    )
  }

  private media(ids: string[]): Map<string, PostMedia> {
    if (ids.length === 0) return new Map()
    const rows = this.db
      .prepare(`SELECT * FROM post_media WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids) as unknown as MediaRow[]
    return new Map(rows.map((row) => [row.id, mediaFromRow(row)]))
  }

  append(message: NewChatMessage): ChatMessage {
    if (!ROLES.includes(message.role)) throw new Error(`Unknown chat role "${message.role}"`)
    const ids = [...new Set(message.media ?? [])]
    const found = this.media(ids)
    const missing = ids.find((id) => !found.has(id))
    if (missing) throw new Error('One of the files is no longer available. Add it again.')
    const saved: ChatMessage = {
      id: randomUUID(),
      role: message.role,
      content: message.content,
      createdAt: this.now().toISOString(),
      via: message.via ?? null,
      media: ids.map((id) => found.get(id)!),
      accountId: message.accountId ?? null,
      mode: modeOf(message.mode ?? null),
      preface: message.preface ?? null
    }
    this.db
      .prepare(
        `INSERT INTO chat_messages
           (id, role, content, created_at, via, media, account_id, mode, preface)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        saved.id,
        saved.role,
        saved.content,
        saved.createdAt,
        saved.via,
        ids.length ? JSON.stringify(ids) : null,
        saved.accountId,
        saved.mode === 'text' ? null : saved.mode,
        saved.preface
      )
    return saved
  }

  /**
   * Empties an account's conversation, leaving the others. Returns the media ids it held, for the
   * caller to discard if unattached.
   */
  clear(account: string | null = null): string[] {
    const ids = [...this.mediaIds(account)]
    const where = scope(account)
    this.db.prepare(`DELETE FROM chat_messages WHERE ${where.sql}`).run(...where.params)
    return ids
  }
}
