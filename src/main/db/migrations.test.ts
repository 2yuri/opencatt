import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { openDatabase } from './database'
import { migrate, migrations, schemaVersion } from './migrations'

describe('migrations', () => {
  it('brings a new database to the latest version', () => {
    const db = openDatabase(':memory:')
    expect(schemaVersion(db)).toBe(migrations.length)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual([
      'accounts',
      'chat_messages',
      'post_media',
      'post_parts',
      'posts',
      'settings',
      'x_media'
    ])
  })

  it('is safe to run twice', () => {
    const db = openDatabase(':memory:')
    expect(() => migrate(db)).not.toThrow()
    expect(schemaVersion(db)).toBe(migrations.length)
  })

  it('refuses a database written by a newer app', () => {
    const db = new DatabaseSync(':memory:')
    db.exec(`PRAGMA user_version = ${migrations.length + 1}`)
    expect(() => migrate(db)).toThrow(/newer than this app/)
  })

  it('rejects a status outside the four we know', () => {
    const db = openDatabase(':memory:')
    expect(() =>
      db
        .prepare(
          "INSERT INTO posts (id, scheduled_at, status, created_at, updated_at) VALUES ('x', 'now', 'draft', 'now', 'now')"
        )
        .run()
    ).toThrow()
  })
})

describe('migration 2: account_id', () => {
  it('keeps posts written at version 1 and leaves their account empty', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, 1)
    db.prepare(
      "INSERT INTO posts (id, text, scheduled_at, status, created_at, updated_at) VALUES ('p1', 'old post', '2026-09-28T08:00:00.000Z', 'scheduled', 'now', 'now')"
    ).run()

    migrate(db, 2)

    expect(schemaVersion(db)).toBe(2)
    expect(db.prepare("SELECT text, account_id FROM posts WHERE id = 'p1'").get()).toEqual({
      text: 'old post',
      account_id: null
    })
  })
})

describe('migration 3: error codes', () => {
  const columns = (db: DatabaseSync): string[] =>
    db
      .prepare('PRAGMA table_info(posts)')
      .all()
      .map((row) => (row as { name: string }).name)
      .sort()

  it('keeps every post, column and index and maps the old codes', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, 2)
    const before = columns(db)
    const insert = db.prepare(
      `INSERT INTO posts (id, account_id, text, scheduled_at, status, error, error_code, created_at, updated_at)
       VALUES (?, 'acc', 'x', '2026-09-28T08:00:00.000Z', ?, ?, ?, 'now', 'now')`
    )
    insert.run('a', 'failed', 'Too many requests', 'rate_limit')
    insert.run('b', 'failed', 'X is down', 'other')
    insert.run('c', 'failed', 'Token expired', 'auth')
    insert.run('d', 'scheduled', null, null)

    migrate(db, 3)

    expect(schemaVersion(db)).toBe(3)
    expect(columns(db)).toEqual(before)
    expect(
      db.prepare('SELECT id, error_code, error, account_id FROM posts ORDER BY id').all()
    ).toEqual([
      { id: 'a', error_code: 'retries_exhausted', error: 'Too many requests', account_id: 'acc' },
      { id: 'b', error_code: 'retries_exhausted', error: 'X is down', account_id: 'acc' },
      { id: 'c', error_code: 'auth', error: 'Token expired', account_id: 'acc' },
      { id: 'd', error_code: null, error: null, account_id: 'acc' }
    ])
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'posts' AND sql IS NOT NULL ORDER BY name"
      )
      .all()
      .map((row) => (row as { name: string }).name)
    expect(indexes).toEqual(['posts_account_id', 'posts_scheduled_at', 'posts_status_scheduled_at'])
  })

  it('accepts the five agreed codes and refuses anything else', () => {
    const db = openDatabase(':memory:')
    const insert = db.prepare(
      `INSERT INTO posts (id, scheduled_at, status, error_code, created_at, updated_at)
       VALUES (?, 'now', 'failed', ?, 'now', 'now')`
    )
    for (const code of ['missed', 'auth', 'rejected', 'retries_exhausted', 'uncertain']) {
      expect(() => insert.run(code, code)).not.toThrow()
    }
    expect(() => insert.run('old', 'rate_limit')).toThrow()
  })
})

describe('migration 4: parts and media', () => {
  const schema = (db: DatabaseSync): unknown[] =>
    db
      .prepare(
        "SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
      )
      .all()
  const columns = (db: DatabaseSync, table: string): string[] =>
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => (row as { name: string }).name)

  it('moves every post into one part with its text and remote ids', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, 3)
    const insert = db.prepare(
      `INSERT INTO posts (id, account_id, text, scheduled_at, status, posted_at, remote_id, remote_url, created_at, updated_at)
       VALUES (?, 'acc', ?, '2026-09-28T08:00:00.000Z', ?, ?, ?, ?, 'now', 'now')`
    )
    insert.run('a', 'still scheduled', 'scheduled', null, null, null)
    insert.run(
      'b',
      'already out',
      'posted',
      '2026-09-28T08:00:05.000Z',
      '99',
      'https://x.com/i/status/99'
    )

    migrate(db, 4)

    expect(schemaVersion(db)).toBe(4)
    expect(columns(db, 'posts')).not.toContain('text')
    expect(
      db
        .prepare(
          'SELECT post_id, position, text, remote_id, remote_url, posted_at FROM post_parts ORDER BY post_id'
        )
        .all()
    ).toEqual([
      {
        post_id: 'a',
        position: 0,
        text: 'still scheduled',
        remote_id: null,
        remote_url: null,
        posted_at: null
      },
      {
        post_id: 'b',
        position: 0,
        text: 'already out',
        remote_id: '99',
        remote_url: 'https://x.com/i/status/99',
        posted_at: '2026-09-28T08:00:05.000Z'
      }
    ])
    expect(db.prepare("SELECT account_id, remote_id FROM posts WHERE id = 'b'").get()).toEqual({
      account_id: 'acc',
      remote_id: '99'
    })
  })

  it('ends with the same schema whether upgraded step by step or created fresh', () => {
    const upgraded = new DatabaseSync(':memory:')
    for (let version = 1; version <= migrations.length; version++) migrate(upgraded, version)
    expect(schema(upgraded)).toEqual(schema(openDatabase(':memory:')))
  })

  it('deletes parts and media rows with their post', () => {
    const db = openDatabase(':memory:')
    db.exec(`
      INSERT INTO posts (id, scheduled_at, status, created_at, updated_at) VALUES ('p', 'now', 'scheduled', 'now', 'now');
      INSERT INTO post_parts (id, post_id, position, text) VALUES ('p0', 'p', 0, 'hi');
      INSERT INTO post_media (id, part_id, position, kind, file, mime, bytes, created_at)
        VALUES ('m', 'p0', 0, 'image', 'm.png', 'image/png', 1, 'now');
    `)
    db.exec("DELETE FROM posts WHERE id = 'p'")
    expect(db.prepare('SELECT COUNT(*) AS n FROM post_parts').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM post_media').get()).toEqual({ n: 0 })
  })
})

describe('migration 6: approval', () => {
  it('rebuilds posts without losing parts or media, and marks existing posts as the user’s', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, 5)
    db.exec(`
      INSERT INTO posts (id, scheduled_at, status, account_id, created_at, updated_at)
        VALUES ('p', '2026-09-28T08:00:00.000Z', 'scheduled', 'acc', 'now', 'now');
      INSERT INTO post_parts (id, post_id, position, text) VALUES ('p0', 'p', 0, 'first'), ('p1', 'p', 1, 'second');
      INSERT INTO post_media (id, part_id, position, kind, file, mime, bytes, created_at)
        VALUES ('m', 'p0', 0, 'image', 'm.png', 'image/png', 1, 'now');
    `)

    migrate(db, 6)

    expect(schemaVersion(db)).toBe(6)
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect(
      db.prepare("SELECT status, created_by, account_id FROM posts WHERE id = 'p'").get()
    ).toEqual({
      status: 'scheduled',
      created_by: 'user',
      account_id: 'acc'
    })
    expect(db.prepare('SELECT id, text FROM post_parts ORDER BY position').all()).toEqual([
      { id: 'p0', text: 'first' },
      { id: 'p1', text: 'second' }
    ])
    expect(db.prepare('SELECT id, part_id FROM post_media').all()).toEqual([
      { id: 'm', part_id: 'p0' }
    ])
    // The foreign key still points at the rebuilt table: deleting the post takes its parts.
    db.exec("DELETE FROM posts WHERE id = 'p'")
    expect(db.prepare('SELECT COUNT(*) AS n FROM post_parts').get()).toEqual({ n: 0 })
  })

  it('accepts pending_approval and the three authors, and nothing else', () => {
    const db = openDatabase(':memory:')
    const insert = db.prepare(
      `INSERT INTO posts (id, scheduled_at, status, created_by, created_at, updated_at)
       VALUES (?, 'now', ?, ?, 'now', 'now')`
    )
    expect(() => insert.run('a', 'pending_approval', 'agent')).not.toThrow()
    expect(() => insert.run('b', 'scheduled', 'mcp')).not.toThrow()
    expect(() => insert.run('c', 'draft', 'user')).toThrow()
    expect(() => insert.run('d', 'scheduled', 'robot')).toThrow()
  })

  it('refuses a migration that leaves broken references, and leaves the database as it was', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, 5)
    db.exec(`
      INSERT INTO posts (id, scheduled_at, status, created_at, updated_at) VALUES ('p', 'now', 'scheduled', 'now', 'now');
      INSERT INTO post_parts (id, post_id, position, text) VALUES ('p0', 'p', 0, 'x');
    `)
    const real = migrations.length
    migrations.push("DELETE FROM posts WHERE id = 'p';")
    try {
      expect(() => migrate(db)).toThrow(/broken references/)
    } finally {
      migrations.pop()
    }
    // Every real migration before it committed; the broken one rolled back.
    expect(schemaVersion(db)).toBe(real)
    expect(db.prepare('SELECT COUNT(*) AS n FROM posts').get()).toEqual({ n: 1 })
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
  })
})

describe('migration 7: rejected', () => {
  it('keeps posts, parts, media and who made them, and accepts the rejected status', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, 6)
    db.exec(`
      INSERT INTO posts (id, scheduled_at, status, created_by, created_at, updated_at)
        VALUES ('p', '2026-09-28T08:00:00.000Z', 'pending_approval', 'agent', 'now', 'now');
      INSERT INTO post_parts (id, post_id, position, text) VALUES ('p0', 'p', 0, 'first'), ('p1', 'p', 1, 'second');
      INSERT INTO post_media (id, part_id, position, kind, file, mime, bytes, created_at)
        VALUES ('m', 'p0', 0, 'image', 'm.png', 'image/png', 1, 'now');
    `)

    migrate(db, 7)

    expect(schemaVersion(db)).toBe(7)
    expect(db.prepare("SELECT status, created_by FROM posts WHERE id = 'p'").get()).toEqual({
      status: 'pending_approval',
      created_by: 'agent'
    })
    expect(db.prepare('SELECT COUNT(*) AS n FROM post_parts').get()).toEqual({ n: 2 })
    expect(db.prepare('SELECT part_id FROM post_media').get()).toEqual({ part_id: 'p0' })
    expect(() => db.exec("UPDATE posts SET status = 'rejected' WHERE id = 'p'")).not.toThrow()
    expect(() => db.exec("UPDATE posts SET status = 'binned' WHERE id = 'p'")).toThrow()
  })
})

describe('migration 11: next_attempt_at', () => {
  it('keeps a scheduled thread with an image as it was, with no retry waiting', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, 10)
    db.exec(`
      INSERT INTO posts (id, scheduled_at, status, created_by, created_at, updated_at, account_id)
        VALUES ('p', '2026-09-28T08:00:00.000Z', 'scheduled', 'user', 'now', 'now', '111');
      INSERT INTO post_parts (id, post_id, position, text) VALUES ('p0', 'p', 0, 'first'), ('p1', 'p', 1, 'second');
      INSERT INTO post_media (id, part_id, position, kind, file, mime, bytes, created_at)
        VALUES ('m', 'p1', 0, 'image', 'm.png', 'image/png', 1, 'now');
    `)

    migrate(db, 11)

    expect(schemaVersion(db)).toBe(11)
    expect(
      db.prepare("SELECT scheduled_at, next_attempt_at, account_id FROM posts WHERE id = 'p'").get()
    ).toEqual({
      scheduled_at: '2026-09-28T08:00:00.000Z',
      next_attempt_at: null,
      account_id: '111'
    })
    expect(db.prepare('SELECT COUNT(*) AS n FROM post_parts').get()).toEqual({ n: 2 })
    expect(db.prepare('SELECT part_id FROM post_media').get()).toEqual({ part_id: 'p1' })
  })
})
