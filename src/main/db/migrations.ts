import type { DatabaseSync } from 'node:sqlite'

// Append-only: never edit a migration once it is merged, add a new one.
// Entry i moves the schema from version i to version i + 1 (PRAGMA user_version).
export const migrations: string[] = [
  `
  CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'posting', 'posted', 'failed')),
    posted_at TEXT,
    remote_id TEXT,
    remote_url TEXT,
    error TEXT,
    error_code TEXT CHECK (error_code IN ('missed', 'auth', 'rate_limit', 'other')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX posts_scheduled_at ON posts (scheduled_at);
  CREATE INDEX posts_status_scheduled_at ON posts (status, scheduled_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX chat_messages_created_at ON chat_messages (created_at);
  `,
  // 2: the X account a post belongs to (its X user id). One account per install for the MVP.
  `
  ALTER TABLE posts ADD COLUMN account_id TEXT;
  CREATE INDEX posts_account_id ON posts (account_id);
  `,
  // 3: error codes agreed for failed posts (#epic-3 thread 36). SQLite can't change a CHECK in
  // place, so the table is rebuilt; rate_limit and other both meant "gave up after retries".
  `
  CREATE TABLE posts_v3 (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('scheduled', 'posting', 'posted', 'failed')),
    posted_at TEXT,
    remote_id TEXT,
    remote_url TEXT,
    error TEXT,
    error_code TEXT CHECK (
      error_code IN ('missed', 'auth', 'rejected', 'retries_exhausted', 'uncertain')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    account_id TEXT
  );
  INSERT INTO posts_v3
    SELECT id, text, scheduled_at, status, posted_at, remote_id, remote_url, error,
      CASE WHEN error_code IN ('rate_limit', 'other') THEN 'retries_exhausted' ELSE error_code END,
      created_at, updated_at, account_id
    FROM posts;
  DROP TABLE posts;
  ALTER TABLE posts_v3 RENAME TO posts;
  CREATE INDEX posts_scheduled_at ON posts (scheduled_at);
  CREATE INDEX posts_status_scheduled_at ON posts (status, scheduled_at);
  CREATE INDEX posts_account_id ON posts (account_id);
  `,
  // 4: threads and media (OP-19). Each post becomes one part; text and the per-part remote ids
  // move to post_parts. post_media rows with no part are imports not attached yet.
  `
  CREATE TABLE post_parts (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    text TEXT NOT NULL,
    remote_id TEXT,
    remote_url TEXT,
    posted_at TEXT,
    UNIQUE (post_id, position)
  );
  INSERT INTO post_parts (id, post_id, position, text, remote_id, remote_url, posted_at)
    SELECT lower(hex(randomblob(16))), id, 0, text, remote_id, remote_url, posted_at FROM posts;

  CREATE TABLE post_media (
    id TEXT PRIMARY KEY,
    part_id TEXT REFERENCES post_parts (id) ON DELETE CASCADE,
    position INTEGER,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'gif', 'video')),
    file TEXT NOT NULL UNIQUE,
    mime TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    duration_ms INTEGER,
    alt TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX post_media_part ON post_media (part_id, position);

  ALTER TABLE posts DROP COLUMN text;
  `,
  // 5: who answered each assistant reply, like "Claude Code · Opus 5" (OP-29).
  `
  ALTER TABLE chat_messages ADD COLUMN via TEXT;
  `,
  // 6: posts the agent or an MCP client writes wait for the user's approval (OP-30). The CHECK on
  // status can't change in place, so posts is rebuilt; post_parts cascades from posts, which is
  // why migrate() runs with foreign keys off.
  `
  CREATE TABLE posts_v6 (
    id TEXT PRIMARY KEY,
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('pending_approval', 'scheduled', 'posting', 'posted', 'failed')
    ),
    posted_at TEXT,
    remote_id TEXT,
    remote_url TEXT,
    error TEXT,
    error_code TEXT CHECK (
      error_code IN ('missed', 'auth', 'rejected', 'retries_exhausted', 'uncertain')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    account_id TEXT,
    created_by TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'agent', 'mcp'))
  );
  INSERT INTO posts_v6 (id, scheduled_at, status, posted_at, remote_id, remote_url, error,
      error_code, created_at, updated_at, account_id, created_by)
    SELECT id, scheduled_at, status, posted_at, remote_id, remote_url, error,
      error_code, created_at, updated_at, account_id, 'user'
    FROM posts;
  DROP TABLE posts;
  ALTER TABLE posts_v6 RENAME TO posts;
  CREATE INDEX posts_scheduled_at ON posts (scheduled_at);
  CREATE INDEX posts_status_scheduled_at ON posts (status, scheduled_at);
  CREATE INDEX posts_account_id ON posts (account_id);
  `,
  // 7: a rejected post stays visible as rejected instead of being deleted (OP-34). Same rebuild as
  // migration 6, run with foreign keys off.
  `
  CREATE TABLE posts_v7 (
    id TEXT PRIMARY KEY,
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('pending_approval', 'rejected', 'scheduled', 'posting', 'posted', 'failed')
    ),
    posted_at TEXT,
    remote_id TEXT,
    remote_url TEXT,
    error TEXT,
    error_code TEXT CHECK (
      error_code IN ('missed', 'auth', 'rejected', 'retries_exhausted', 'uncertain')
    ),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    account_id TEXT,
    created_by TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'agent', 'mcp'))
  );
  INSERT INTO posts_v7 (id, scheduled_at, status, posted_at, remote_id, remote_url, error,
      error_code, created_at, updated_at, account_id, created_by)
    SELECT id, scheduled_at, status, posted_at, remote_id, remote_url, error,
      error_code, created_at, updated_at, account_id, created_by
    FROM posts;
  DROP TABLE posts;
  ALTER TABLE posts_v7 RENAME TO posts;
  CREATE INDEX posts_scheduled_at ON posts (scheduled_at);
  CREATE INDEX posts_status_scheduled_at ON posts (status, scheduled_at);
  CREATE INDEX posts_account_id ON posts (account_id);
  `,
  // 8: X accounts connected through the user's one X app (OP-5); posts.account_id holds their id.
  // Their tokens are in the encrypted credentials file, never here.
  `
  CREATE TABLE accounts (
    id TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    mode TEXT NOT NULL CHECK (mode IN ('oauth2', 'oauth1')),
    needs_reconnect INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // 9: files the user attached to a chat message (OP-21), as a JSON array of post_media ids.
  `
  ALTER TABLE chat_messages ADD COLUMN media TEXT;
  `,
  // 10: each X account has its own conversation with the agent (OP-61). Messages from before any
  // account was connected keep a NULL account and move to the first one when it connects.
  `
  ALTER TABLE chat_messages ADD COLUMN account_id TEXT;
  CREATE INDEX chat_messages_account ON chat_messages (account_id, created_at);
  `,
  // 11: when the publisher tries a post again after X couldn't take it (OP-69). scheduled_at stays
  // the time the user picked; null whenever no retry is waiting.
  `
  ALTER TABLE posts ADD COLUMN next_attempt_at TEXT;
  `,
  // 12: a video already uploaded to X for an account, so a post doesn't wait on the upload or on
  // X processing it when it is due (OP-70). X keeps media ids for 24 hours.
  `
  CREATE TABLE x_media (
    media_id TEXT NOT NULL REFERENCES post_media (id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    x_media_id TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    ready INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (media_id, account_id)
  );
  `,
  // 13: what the user asked the agent to make with a message: a post, an image or a video (OP-79).
  `
  ALTER TABLE chat_messages ADD COLUMN mode TEXT;
  `,
  // 14: the instruction Video mode puts before the user's text (OP-81), saved as sent so a later
  // edit of the pre-prompt never rewrites old messages.
  `
  ALTER TABLE chat_messages ADD COLUMN preface TEXT;
  `,
  // 15: several conversations per account (OP-94). Each account's messages, and the ones from
  // before any account, become one chat called "Chat", which keeps the Claude Code session the
  // account was in. title_set stops the first message from renaming a chat that has a title.
  `
  CREATE TABLE chat_sessions (
    id TEXT PRIMARY KEY,
    account_id TEXT,
    title TEXT NOT NULL,
    title_set INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    cli_session_id TEXT,
    archived INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX chat_sessions_account ON chat_sessions (account_id, updated_at);
  ALTER TABLE chat_messages ADD COLUMN session_id TEXT;
  INSERT INTO chat_sessions (id, account_id, title, title_set, created_at, updated_at, cli_session_id)
    SELECT
      lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) ||
        '-a' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
      m.account_id, 'Chat', 1, MIN(m.created_at), MAX(m.created_at),
      COALESCE(
        (SELECT value FROM settings WHERE key = 'agent.cliSession.' || m.account_id),
        (SELECT value FROM settings WHERE key = 'agent.cliSession')
      )
    FROM chat_messages m
    GROUP BY m.account_id;
  UPDATE chat_messages
    SET session_id = (SELECT s.id FROM chat_sessions s WHERE s.account_id IS chat_messages.account_id);
  CREATE INDEX chat_messages_session ON chat_messages (session_id, created_at);
  `
]

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  return row.user_version
}

export function migrate(db: DatabaseSync, target = migrations.length): void {
  const current = schemaVersion(db)
  if (current > migrations.length) {
    throw new Error(
      `Database schema is version ${current}, newer than this app (${migrations.length}). Update OpenCatt.`
    )
  }
  if (current >= target) return

  // A migration that rebuilds a table (DROP, then RENAME the copy) would cascade-delete every row
  // that references it while foreign keys are on. SQLite only lets that setting change outside a
  // transaction, so it is switched off around all migrations and checked before each commit.
  const fkWasOn = (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    for (let version = current; version < target; version++) {
      db.exec('BEGIN')
      try {
        db.exec(migrations[version])
        const broken = db.prepare('PRAGMA foreign_key_check').all()
        if (broken.length > 0) {
          throw new Error(
            `Migration ${version + 1} left ${broken.length} broken references: ${JSON.stringify(broken[0])}`
          )
        }
        db.exec(`PRAGMA user_version = ${version + 1}`)
        db.exec('COMMIT')
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    }
  } finally {
    if (fkWasOn) db.exec('PRAGMA foreign_keys = ON')
  }
}
