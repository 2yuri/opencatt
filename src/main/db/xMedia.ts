import type { Database } from './database'

/** A video X has for an account: its media id, when it went up, and whether X finished it. */
export interface XMedia {
  xMediaId: string
  uploadedAt: Date
  ready: boolean
}

/** X's media ids for our videos, per account (OP-70). Rows go with their media file. */
export class XMediaStore {
  constructor(private readonly db: Database) {}

  get(mediaId: string, accountId: string): XMedia | null {
    const row = this.db
      .prepare('SELECT * FROM x_media WHERE media_id = ? AND account_id = ?')
      .get(mediaId, accountId) as
      { x_media_id: string; uploaded_at: string; ready: number } | undefined
    return row
      ? { xMediaId: row.x_media_id, uploadedAt: new Date(row.uploaded_at), ready: row.ready === 1 }
      : null
  }

  save(mediaId: string, accountId: string, media: XMedia): void {
    this.db
      .prepare(
        `INSERT INTO x_media (media_id, account_id, x_media_id, uploaded_at, ready)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (media_id, account_id) DO UPDATE SET x_media_id = excluded.x_media_id,
           uploaded_at = excluded.uploaded_at, ready = excluded.ready`
      )
      .run(mediaId, accountId, media.xMediaId, media.uploadedAt.toISOString(), media.ready ? 1 : 0)
  }

  forget(mediaId: string, accountId: string): void {
    this.db
      .prepare('DELETE FROM x_media WHERE media_id = ? AND account_id = ?')
      .run(mediaId, accountId)
  }
}
