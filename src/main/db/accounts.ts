import type { XAccount } from '@shared/api'
import type { XAuthMode } from '@shared/x'
import type { Database } from './database'

interface AccountRow {
  id: string
  handle: string
  name: string | null
  avatar_url: string | null
  mode: XAuthMode
  needs_reconnect: number
  added_at: string
  updated_at: string
}

export interface AccountProfile {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
  mode: XAuthMode
}

/** The X accounts the user connected, oldest first. Their tokens live in the CredentialStore. */
export class AccountsStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date()
  ) {}

  list(): XAccount[] {
    const rows = this.db
      .prepare('SELECT * FROM accounts ORDER BY added_at, id')
      .all() as unknown as AccountRow[]
    return rows.map(fromRow)
  }

  get(id: string): XAccount | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as
      AccountRow | undefined
    return row ? fromRow(row) : null
  }

  /** Adds the account, or refreshes its profile and clears needsReconnect when it is known. */
  save(profile: AccountProfile): XAccount {
    const at = this.now().toISOString()
    this.db
      .prepare(
        `INSERT INTO accounts (id, handle, name, avatar_url, mode, needs_reconnect, added_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT (id) DO UPDATE SET handle = excluded.handle, name = excluded.name,
           avatar_url = excluded.avatar_url, mode = excluded.mode, needs_reconnect = 0,
           updated_at = excluded.updated_at`
      )
      .run(profile.id, profile.handle, profile.name, profile.avatarUrl, profile.mode, at, at)
    return this.get(profile.id)!
  }

  setNeedsReconnect(id: string, needsReconnect: boolean): void {
    this.db
      .prepare('UPDATE accounts SET needs_reconnect = ?, updated_at = ? WHERE id = ?')
      .run(needsReconnect ? 1 : 0, this.now().toISOString(), id)
  }
}

function fromRow(row: AccountRow): XAccount {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    avatarUrl: row.avatar_url,
    mode: row.mode,
    needsReconnect: row.needs_reconnect === 1
  }
}
