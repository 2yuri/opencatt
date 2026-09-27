import type { JsonValue } from '@shared/api'
import type { Database } from './database'

/** Plain app settings as JSON. Tokens, client secrets and API keys belong in the keychain, not here. */
export class SettingsStore {
  constructor(private readonly db: Database) {}

  get(key: string): JsonValue | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return row ? (JSON.parse(row.value) as JsonValue) : null
  }

  set(key: string, value: JsonValue): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
      )
      .run(key, JSON.stringify(value))
  }
}
