import { describe, expect, it } from 'vitest'
import { openDatabase } from './database'
import { XMediaStore } from './xMedia'

describe('XMediaStore', () => {
  it('keeps one X media id per video and account, and drops it with the video', () => {
    const db = openDatabase(':memory:')
    db.exec(`INSERT INTO post_media (id, kind, file, mime, bytes, created_at)
      VALUES ('m', 'video', 'm.mp4', 'video/mp4', 1, 'now')`)
    const store = new XMediaStore(db)
    const at = new Date('2026-09-28T09:00:00Z')
    store.save('m', 'alice', { xMediaId: 'x1', uploadedAt: at, ready: false })
    store.save('m', 'alice', { xMediaId: 'x1', uploadedAt: at, ready: true })
    store.save('m', 'bob', { xMediaId: 'x2', uploadedAt: at, ready: false })
    expect(store.get('m', 'alice')).toEqual({ xMediaId: 'x1', uploadedAt: at, ready: true })
    expect(store.get('m', 'bob')?.xMediaId).toBe('x2')
    store.forget('m', 'bob')
    expect(store.get('m', 'bob')).toBeNull()
    db.exec("DELETE FROM post_media WHERE id = 'm'")
    expect(store.get('m', 'alice')).toBeNull()
  })
})
