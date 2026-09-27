import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, join } from 'node:path'
import type { PostMedia } from '@shared/api'
import type { Database } from '../db/database'
import { MEDIA_FILE, looksLike, mediaTypeFor, mediaUrl } from './files'

export interface MediaRow {
  id: string
  part_id: string | null
  position: number | null
  kind: PostMedia['kind']
  file: string
  mime: string
  bytes: number
  width: number | null
  height: number | null
  duration_ms: number | null
  alt: string | null
  created_at: string
}

export function mediaFromRow(row: MediaRow): PostMedia {
  return {
    id: row.id,
    kind: row.kind,
    mime: row.mime,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    alt: row.alt,
    url: mediaUrl(row.file)
  }
}

/** A file X would refuse, or one we can't read. The message is for the user. */
export class MediaError extends Error {
  override name = 'MediaError'
}

/** Reads an image's size; in the app it is Electron's nativeImage, tests pass their own. */
export type ImageProbe = (path: string) => { width: number; height: number } | null

/** How long an import may sit unattached before the startup sweep removes it. */
const UNATTACHED_TTL_MS = 24 * 60 * 60 * 1000

/**
 * The media folder and its unattached imports. Files are copied in on import so a scheduled post
 * still goes out when the user moves or deletes the original. PostsService attaches them to parts.
 */
export class MediaStore {
  constructor(
    private readonly db: Database,
    readonly dir: string,
    private readonly probe: ImageProbe = () => null,
    private readonly now: () => Date = () => new Date()
  ) {
    mkdirSync(dir, { recursive: true })
  }

  /** Where a video conversion writes before import(…, { owned: true }) moves it in. */
  tempPath(ext = '.mp4'): string {
    return join(this.dir, `tmp-${randomUUID()}${ext}`)
  }

  /**
   * Copies a file in, or moves it when `video.owned` (a conversion written to tempPath()).
   * `video` carries what ffprobe found (OP-18).
   */
  import(
    path: string,
    video?: { width: number; height: number; durationMs: number; owned?: boolean }
  ): PostMedia {
    const name = basename(path)
    const type = mediaTypeFor(path)
    if (!type) {
      throw new MediaError(`${name}: X takes JPG, PNG, WEBP and GIF images and MP4 or MOV videos.`)
    }
    let bytes: number
    try {
      const stat = statSync(path)
      if (!stat.isFile()) throw new Error('not a file')
      bytes = stat.size
    } catch {
      throw new MediaError(`${name} can't be read. Check that the file still exists.`)
    }
    if (bytes === 0) throw new MediaError(`${name} is empty.`)
    if (bytes > type.maxBytes) {
      const limit = Math.round(type.maxBytes / (1024 * 1024))
      throw new MediaError(`${name} is larger than X allows for this kind of file (${limit} MB).`)
    }
    if (!looksLike(path, type)) {
      throw new MediaError(`${name} isn't really a ${type.ext.slice(1).toUpperCase()} file.`)
    }

    const id = randomUUID()
    const file = `${id}${type.ext}`
    if (video?.owned) renameSync(path, join(this.dir, file))
    else copyFileSync(path, join(this.dir, file))
    const size = type.kind === 'video' ? (video ?? null) : this.probe(join(this.dir, file))
    this.db
      .prepare(
        `INSERT INTO post_media (id, kind, file, mime, bytes, width, height, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        type.kind,
        file,
        type.mime,
        bytes,
        size?.width ?? null,
        size?.height ?? null,
        video?.durationMs ?? null,
        this.now().toISOString()
      )
    return mediaFromRow(this.row(id)!)
  }

  /** Saves a PNG made in the app, like an agent render (OP-33), as an unattached import. */
  importPng(png: Buffer, size: { width: number; height: number }): PostMedia {
    const id = randomUUID()
    const file = `${id}.png`
    writeFileSync(join(this.dir, file), png)
    this.db
      .prepare(
        `INSERT INTO post_media (id, kind, file, mime, bytes, width, height, created_at)
         VALUES (?, 'image', ?, 'image/png', ?, ?, ?, ?)`
      )
      .run(id, file, png.length, size.width, size.height, this.now().toISOString())
    return mediaFromRow(this.row(id)!)
  }

  /** Removes an import that was never attached. Attached media goes away with its post. */
  discard(id: string): void {
    const row = this.row(id)
    if (!row) return
    if (row.part_id !== null) throw new MediaError('That file is attached to a post.')
    this.db.prepare('DELETE FROM post_media WHERE id = ?').run(id)
    this.removeFiles([row.file])
  }

  /** The media with this id, or null. */
  get(id: string): PostMedia | null {
    const row = this.row(id)
    return row ? mediaFromRow(row) : null
  }

  /** Absolute path of a media file, for the publisher to upload. */
  pathOf(id: string): string {
    const row = this.row(id)
    if (!row) throw new MediaError(`No media with id ${id}`)
    return join(this.dir, row.file)
  }

  /** The folder path for a file name, or null when the name isn't one of ours. */
  resolve(file: string): string | null {
    return MEDIA_FILE.test(file) ? join(this.dir, file) : null
  }

  removeFiles(files: string[]): void {
    for (const file of files) {
      const path = this.resolve(file)
      if (path) rmSync(path, { force: true })
    }
  }

  /**
   * Startup cleanup: imports never attached within a day, and files with no row at all
   * (a crash between copying and saving). `keep` spares unattached media the chat still shows;
   * clearing the chat releases them. Returns how many files were removed.
   */
  sweep(keep: ReadonlySet<string> = new Set()): number {
    const cutoff = new Date(this.now().getTime() - UNATTACHED_TTL_MS).toISOString()
    const stale = (
      this.db
        .prepare('SELECT id, file FROM post_media WHERE part_id IS NULL AND created_at < ?')
        .all(cutoff) as unknown as { id: string; file: string }[]
    ).filter((row) => !keep.has(row.id))
    const drop = this.db.prepare('DELETE FROM post_media WHERE id = ?')
    for (const row of stale) drop.run(row.id)

    const known = new Set(
      (this.db.prepare('SELECT file FROM post_media').all() as unknown as { file: string }[]).map(
        (row) => row.file
      )
    )
    const strays = existsSync(this.dir)
      ? readdirSync(this.dir).filter((file) => MEDIA_FILE.test(file) && !known.has(file))
      : []
    // Conversions cut short by a crash or a quit (OP-18).
    for (const file of existsSync(this.dir) ? readdirSync(this.dir) : []) {
      if (/^tmp-[0-9a-f-]{36}\.mp4$/.test(file)) rmSync(join(this.dir, file), { force: true })
    }
    const files = [...new Set([...stale.map((row) => row.file), ...strays])]
    this.removeFiles(files)
    return files.length
  }

  private row(id: string): MediaRow | undefined {
    return this.db.prepare('SELECT * FROM post_media WHERE id = ?').get(id) as MediaRow | undefined
  }
}
