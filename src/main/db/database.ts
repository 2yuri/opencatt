import { DatabaseSync } from 'node:sqlite'
import { migrate } from './migrations'

export type Database = DatabaseSync

/** Opens (or creates) the database at `path` and brings its schema up to date. Use ':memory:' in tests. */
export function openDatabase(path: string): Database {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  migrate(db)
  return db
}

/** Runs `fn` in a transaction, rolling back if it throws. */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
