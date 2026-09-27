import { copyFileSync, existsSync, readdirSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../db/database'
import { MediaImports } from './imports'
import { MediaError, MediaStore } from './store'
import { fakeMedia, tempDir } from './testFiles'
import type { PrepareOptions, VideoPreparer, VideoInfo } from './video'

const info: VideoInfo = {
  durationMs: 12_000,
  width: 1280,
  height: 720,
  fps: 30,
  videoCodec: 'h264',
  pixFmt: 'yuv420p',
  audioCodec: 'aac',
  bitRate: null,
  hdr: false
}

function setup(prepare: (path: string, o: PrepareOptions) => ReturnType<VideoPreparer['prepare']>) {
  const src = tempDir()
  const store = new MediaStore(openDatabase(':memory:'), tempDir(), () => ({
    width: 10,
    height: 10
  }))
  const progress: [string, number][] = []
  const imports = new MediaImports(
    store,
    { prepare: vi.fn(prepare) } as unknown as VideoPreparer,
    (path, fraction) => progress.push([path, fraction])
  )
  return { src, store, imports, progress }
}

describe('MediaImports', () => {
  it('keeps a converted video by moving it in, with its length and size', async () => {
    const t = setup(async (_path, o) => {
      copyFileSync(fakeMedia(tempDir(), 'x.mp4', 1000), o.output)
      o.onProgress?.(0.5)
      return { path: o.output, info, plan: 'convert' }
    })
    const input = fakeMedia(t.src, 'phone.mov', 500)
    const [video] = await t.imports.import([input])
    expect(video).toMatchObject({
      kind: 'video',
      mime: 'video/mp4',
      durationMs: 12_000,
      width: 1280
    })
    expect(t.progress).toEqual([[input, 0.5]])
    // Moved, not copied: no tmp- file is left behind.
    expect(readdirSync(t.store.dir).filter((f) => f.startsWith('tmp-'))).toEqual([])
    expect(existsSync(t.store.pathOf(video!.id))).toBe(true)
  })

  it('copies a video X takes as it is, and images straight through', async () => {
    const t = setup(async (path) => ({ path, info, plan: 'copy' }))
    const [image, video] = await t.imports.import([
      fakeMedia(t.src, 'a.png'),
      fakeMedia(t.src, 'b.mp4', 800)
    ])
    expect(image?.kind).toBe('image')
    expect(video).toMatchObject({ kind: 'video', bytes: 800, durationMs: 12_000 })
  })

  it('imports all or nothing: a refused video drops the rest of the batch', async () => {
    const t = setup(async () => {
      throw new MediaError('X takes videos up to 2 minutes 20 seconds, and this one is 2 min 30 s.')
    })
    await expect(
      t.imports.import([fakeMedia(t.src, 'a.png'), fakeMedia(t.src, 'long.mp4')])
    ).rejects.toThrow(/2 minutes 20 seconds/)
    expect(readdirSync(t.store.dir)).toEqual([])
  })

  it('cancels the conversion in progress', async () => {
    const t = setup(
      (_path, o) =>
        new Promise((_resolve, reject) =>
          o.signal?.addEventListener('abort', () =>
            reject(new MediaError('Adding the video was cancelled.'))
          )
        )
    )
    const running = t.imports.import([fakeMedia(t.src, 'big.mov')])
    await new Promise((r) => setTimeout(r, 0))
    t.imports.cancelImport()
    await expect(running).rejects.toThrow(/cancelled/)
    expect(readdirSync(t.store.dir)).toEqual([])
  })
})
