import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** The types a paste can carry without a file behind it, and the extension import() expects. */
const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov'
}

/** X's largest file, a video; anything bigger would be refused on import anyway. */
const MAX_BYTES = 512 * 1024 * 1024

/**
 * Pasted images with no file behind them, like a screenshot or an image copied in a browser
 * (OP-89). Each is written to a temporary file so it goes through import() like any other file,
 * and removed once imported.
 */
export class PastedFiles {
  constructor(private readonly dir: string) {}

  save(data: Uint8Array, type: string): string {
    const ext = EXTENSIONS[type]
    if (!ext) throw new Error("OpenCatt can't add that kind of file. Paste an image or a video.")
    if (data.byteLength === 0) throw new Error('The pasted file is empty.')
    if (data.byteLength > MAX_BYTES) throw new Error('The pasted file is larger than X allows.')
    mkdirSync(this.dir, { recursive: true })
    const path = join(this.dir, `${randomUUID()}${ext}`)
    writeFileSync(path, data)
    return path
  }

  /** Removes the given paths that are ours, once they have been imported or refused. */
  release(paths: string[]): void {
    for (const path of paths) {
      if (dirname(resolve(path)) === resolve(this.dir)) rmSync(path, { force: true })
    }
  }

  /** Startup: anything left from a paste that never finished importing. */
  sweep(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }
}
