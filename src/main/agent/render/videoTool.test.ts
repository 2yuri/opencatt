import { describe, expect, it, vi } from 'vitest'
import type { PostMedia } from '@shared/api'
import { callTool } from '../tools'
import { RenderError } from './tool'
import { renderVideoTool, type VideoRecorder } from './videoTool'

vi.mock('electron', () => ({ BrowserWindow: class {}, session: {} }))
const { recordArgs, videoPage } = await import('./recorder')

function setup(recorder?: Partial<VideoRecorder>) {
  const record = vi.fn<VideoRecorder['record']>(
    recorder?.record ??
      (async (_html, spec) => ({
        path: '/tmp/x.mp4',
        poster: Buffer.from('png'),
        seconds: spec.seconds
      }))
  )
  const imported: unknown[] = []
  const stop = new AbortController()
  const tool = renderVideoTool(
    { record },
    {
      import: (path, video): PostMedia => {
        imported.push({ path, ...video })
        return {
          id: 'v1',
          kind: 'video',
          mime: 'video/mp4',
          bytes: 3_000_000,
          width: video.width,
          height: video.height,
          durationMs: video.durationMs,
          alt: null,
          url: 'opencat-media://media/v1.mp4'
        }
      }
    },
    () => stop.signal,
    (png) => ({ mediaType: 'image/png', data: png.toString('base64') })
  )
  return {
    record,
    imported,
    stop,
    run: (input: unknown) => callTool([tool], 'render_video', input)
  }
}

describe('render_video', () => {
  it('records 15 s at 1280x720 by default, imports the MP4 and shows the model the middle frame', async () => {
    const { record, imported, stop, run } = setup()
    const out = await run({ html: '<p>go</p>' })

    expect(out.isError).toBe(false)
    expect(record).toHaveBeenCalledWith(
      '<p>go</p>',
      { width: 1280, height: 720, seconds: 15 },
      stop.signal,
      new Map()
    )
    expect(imported).toEqual([
      { path: '/tmp/x.mp4', width: 1280, height: 720, durationMs: 15_000, owned: true }
    ])
    expect(JSON.parse(out.content)).toMatchObject({ media_id: 'v1', seconds: 15 })
    expect(out.image).toEqual({
      mediaType: 'image/png',
      data: Buffer.from('png').toString('base64')
    })
    expect(out.result).toMatchObject({ kind: 'render', mediaId: 'v1', durationMs: 15_000 })
  })

  it('refuses lengths and sizes it cannot record', async () => {
    const { record, run } = setup()
    const cases: [unknown, RegExp][] = [
      [{ html: 'x', seconds: 61 }, /between 1 and 60/],
      [{ html: 'x', seconds: 0 }, /between 1 and 60/],
      [{ html: 'x', width: 1921 }, /between 200 and 1920/],
      [{ html: 'x', width: 1281 }, /even/],
      [{ html: '' }, /non-empty/],
      [{ html: 'x', width: 1920, height: 1920 }, /1920x1920 is larger than X takes/],
      [
        { html: 'x', width: 1600, height: 1600 },
        /up to 1920x1200 landscape or square, 1200x1900 portrait/
      ],
      [{ html: 'x', width: 1400, height: 1900 }, /larger than X takes/]
    ]
    for (const [input, message] of cases) {
      const out = await run(input)
      expect(out.isError).toBe(true)
      expect(out.content).toMatch(message)
    }
    expect(record).not.toHaveBeenCalled()
  })

  it('takes the largest frames X does, in each direction', async () => {
    const { record, run } = setup()
    for (const [width, height] of [
      [1920, 1200],
      [1200, 1900],
      [1080, 1080]
    ]) {
      expect((await run({ html: 'x', width, height, seconds: 1 })).isError).toBe(false)
    }
    expect(record).toHaveBeenCalledTimes(3)
  })

  it('returns a failed or stopped recording to the model as an error it can act on', async () => {
    const { imported, run } = setup({
      record: async () => {
        throw new RenderError('The recording took over 2 minutes. Make it shorter or simpler.')
      }
    })
    const out = await run({ html: '<p>slow</p>', seconds: 60 })
    expect(out.isError).toBe(true)
    expect(out.content).toMatch(/over 2 minutes/)
    expect(imported).toEqual([])
  })
})

describe('render_video with HyperFrames', () => {
  const comp = (w: number, h: number, d: number): string =>
    `<div data-composition-id="main" data-width="${w}" data-height="${h}" data-duration="${d}"></div>`

  it('takes the length from the root data-duration the recorder reports', async () => {
    const { imported, run } = setup({
      record: async () => ({ path: '/tmp/x.mp4', poster: Buffer.from('p'), seconds: 12 })
    })
    const out = await run({ html: comp(1280, 720, 12), seconds: 15 })
    expect(out.isError).toBe(false)
    expect(imported[0]).toMatchObject({ durationMs: 12_000 })
    expect(JSON.parse(out.content)).toMatchObject({ seconds: 12 })
  })

  it('refuses a root sized differently from the video', async () => {
    const { record, run } = setup()
    const out = await run({ html: comp(1920, 1080, 15) })
    expect(out.isError).toBe(true)
    expect(out.content).toMatch(/1920x1080\) must match the video's width and height \(1280x720\)/)
    expect(record).not.toHaveBeenCalled()
  })
})

describe('recorder pieces', () => {
  it('puts the no-network policy first in the page and sizes it to the video', () => {
    const page = videoPage('<html><head><link href="https://x.test/a.css"></head></html>', {
      width: 1080,
      height: 1080
    })
    expect(page.indexOf("default-src 'none'")).toBeLessThan(page.indexOf('<link'))
    expect(page).toContain("script-src 'unsafe-inline'")
    expect(page).toContain('width:1080px;height:1080px')
  })

  it('pipes raw frames into the platform encoder', () => {
    const args = recordArgs({ width: 1280, height: 720, seconds: 15 }, '/tmp/o.mp4', 'darwin').join(
      ' '
    )
    expect(args).toContain('-f rawvideo -pix_fmt bgra -s 1280x720 -r 30 -i pipe:0')
    expect(args).toContain('-c:v h264_videotoolbox -allow_sw 1')
    expect(args).toContain('-pix_fmt yuv420p -movflags +faststart /tmp/o.mp4')
    expect(recordArgs({ width: 2, height: 2, seconds: 1 }, 'o', 'win32')).toContain('h264_mf')
  })
})

describe('render_video recordings per turn (OP-91)', () => {
  it('counts every recording, says how many are left, and refuses a fourth', async () => {
    let used = 0
    const record = vi.fn<VideoRecorder['record']>(async (_html, spec) => {
      if (used === 3) throw new RenderError('The composition broke.')
      return { path: '/tmp/x.mp4', poster: Buffer.from('png'), seconds: spec.seconds }
    })
    const tool = renderVideoTool(
      { record },
      {
        import: (_path, video): PostMedia => ({
          id: 'v1',
          kind: 'video',
          mime: 'video/mp4',
          bytes: 1,
          width: video.width,
          height: video.height,
          durationMs: video.durationMs,
          alt: null,
          url: 'opencat-media://media/v1.mp4'
        })
      },
      () => null,
      () => null,
      undefined,
      { used: () => used, add: () => void used++ }
    )
    const run = (): ReturnType<typeof callTool> =>
      callTool([tool], 'render_video', { html: '<p>go</p>', seconds: 2 })

    expect(JSON.parse((await run()).content).recordings_left).toBe(
      '2 of 3 recordings left this turn. Record again only for a real fault you can see in the frame.'
    )
    expect(JSON.parse((await run()).content).recordings_left).toMatch(/^1 of 3/)
    // A recording that fails still counts: it took its time.
    expect((await run()).isError).toBe(true)
    expect(used).toBe(3)

    const refused = await run()
    expect(refused.isError).toBe(true)
    expect(JSON.parse(refused.content).error).toContain("You've recorded 3 videos this turn")
    expect(record).toHaveBeenCalledTimes(3)
  })
})
