import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../db/database'
import { MediaError, MediaStore } from './store'
import { fakeMedia, tempDir } from './testFiles'

function setup(now = () => new Date('2026-09-26T10:00:00Z')) {
  const source = tempDir('opencat-src-')
  const dir = join(tempDir(), 'media')
  const db = openDatabase(':memory:')
  const media = new MediaStore(db, dir, () => ({ width: 1200, height: 675 }), now)
  return { source, dir, db, media }
}

describe('MediaStore.import', () => {
  it('copies the file into the media folder and describes it', () => {
    const { source, dir, media } = setup()
    const original = fakeMedia(source, 'Holiday Photo.JPEG', 2048)

    const imported = media.import(original)

    expect(imported).toMatchObject({
      kind: 'image',
      mime: 'image/jpeg',
      bytes: 2048,
      width: 1200,
      height: 675,
      alt: null
    })
    expect(imported.url).toMatch(/^opencat-media:\/\/media\/[0-9a-f-]{36}\.jpg$/)
    expect(readdirSync(dir)).toEqual([`${imported.id}.jpg`])
    expect(media.pathOf(imported.id)).toBe(join(dir, `${imported.id}.jpg`))
  })

  it('knows GIFs and videos apart from images, and does not probe videos', () => {
    const { source, media } = setup()
    expect(media.import(fakeMedia(source, 'a.gif')).kind).toBe('gif')
    const video = media.import(fakeMedia(source, 'clip.mov'))
    expect(video).toMatchObject({ kind: 'video', mime: 'video/quicktime', width: null })
  })

  it('refuses what X would refuse, with a message that names the file', () => {
    const { source, media } = setup()
    expect(() => media.import(fakeMedia(source, 'notes.pdf'))).toThrow(/notes\.pdf: X takes/)
    expect(() => media.import(fakeMedia(source, 'huge.png', 5 * 1024 * 1024 + 1))).toThrow(
      /larger than X allows.*5 MB/
    )
    expect(() => media.import(join(source, 'gone.png'))).toThrow(/can't be read/)
    const renamed = join(source, 'fake.png')
    writeFileSync(renamed, 'this is text, not a png at all')
    expect(() => media.import(renamed)).toThrow(/isn't really a PNG/)
    writeFileSync(join(source, 'empty.png'), '')
    expect(() => media.import(join(source, 'empty.png'))).toThrow(/empty\.png is empty/)
  })

  it('discards an unattached import and its file', () => {
    const { source, dir, media } = setup()
    const imported = media.import(fakeMedia(source, 'a.png'))
    media.discard(imported.id)
    expect(readdirSync(dir)).toEqual([])
    expect(() => media.pathOf(imported.id)).toThrow(MediaError)
  })

  it('only resolves names it created', () => {
    const { media, dir } = setup()
    expect(media.resolve('../opencat.db')).toBeNull()
    expect(media.resolve('..%2Fopencat.db')).toBeNull()
    expect(media.resolve('0f8fad5b-d9cb-469f-a165-70867728950e.png')).toBe(
      join(dir, '0f8fad5b-d9cb-469f-a165-70867728950e.png')
    )
  })
})

describe('MediaStore.sweep', () => {
  it('removes imports left unattached for a day and stray files, and keeps the rest', () => {
    let clock = new Date('2026-09-25T09:00:00Z')
    const { source, dir, db, media } = setup(() => clock)
    const old = media.import(fakeMedia(source, 'old.png'))
    const attached = media.import(fakeMedia(source, 'kept.png'))
    db.exec(`
      INSERT INTO posts (id, scheduled_at, status, created_at, updated_at) VALUES ('p', 'now', 'scheduled', 'now', 'now');
      INSERT INTO post_parts (id, post_id, position, text) VALUES ('p0', 'p', 0, 'hi');
    `)
    db.prepare("UPDATE post_media SET part_id = 'p0', position = 0 WHERE id = ?").run(attached.id)
    clock = new Date('2026-09-26T10:00:00Z')
    const fresh = media.import(fakeMedia(source, 'fresh.png'))
    const stray = '0f8fad5b-d9cb-469f-a165-70867728950e.png'
    writeFileSync(join(dir, stray), 'left over from a crash')
    writeFileSync(join(dir, 'README.txt'), 'not ours, never touched')

    expect(media.sweep()).toBe(2)

    expect(existsSync(join(dir, `${old.id}.png`))).toBe(false)
    expect(existsSync(join(dir, stray))).toBe(false)
    expect(existsSync(join(dir, `${attached.id}.png`))).toBe(true)
    expect(existsSync(join(dir, `${fresh.id}.png`))).toBe(true)
    expect(existsSync(join(dir, 'README.txt'))).toBe(true)
  })
})

describe('MediaStore renders and kept media', () => {
  it('saves a PNG made in the app with the size it was drawn at', () => {
    const { dir, media } = setup()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const saved = media.importPng(png, { width: 1080, height: 1080 })
    expect(saved).toMatchObject({ kind: 'image', mime: 'image/png', bytes: 11, width: 1080 })
    expect(existsSync(join(dir, `${saved.id}.png`))).toBe(true)
  })

  it('keeps old unattached media the chat still shows', () => {
    let clock = new Date('2026-09-25T09:00:00Z')
    const { source, dir, media } = setup(() => clock)
    const shown = media.import(fakeMedia(source, 'shown.png'))
    const gone = media.import(fakeMedia(source, 'gone.png'))
    clock = new Date('2026-09-26T10:00:00Z')

    expect(media.sweep(new Set([shown.id]))).toBe(1)
    expect(existsSync(join(dir, `${shown.id}.png`))).toBe(true)
    expect(existsSync(join(dir, `${gone.id}.png`))).toBe(false)
  })
})
