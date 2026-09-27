import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function tempDir(prefix = 'opencat-media-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

const HEADERS: Record<string, Buffer> = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]),
  jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]),
  gif: Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00', 'latin1'),
  webp: Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'latin1'),
  mp4: Buffer.from('\x00\x00\x00\x18ftypmp42', 'latin1')
}

/** Writes a file that starts like a real one of that type, padded to `bytes`. */
export function fakeMedia(dir: string, name: string, bytes = 64): string {
  const ext = name.split('.').pop()!.toLowerCase()
  const head =
    HEADERS[ext === 'jpeg' ? 'jpg' : ext === 'mov' ? 'mp4' : ext] ?? Buffer.from('not media at all')
  const body = Buffer.alloc(Math.max(bytes, head.length))
  head.copy(body)
  const path = join(dir, name)
  writeFileSync(path, body)
  return path
}
