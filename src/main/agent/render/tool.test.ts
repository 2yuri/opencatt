import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../db/database'
import { MediaStore } from '../../media/store'
import { tempDir } from '../../media/testFiles'
import { callTool } from '../tools'
import { renderImageTool, RenderError, type HtmlRenderer } from './tool'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])

function setup(renderer: HtmlRenderer = { render: async () => PNG }) {
  const media = new MediaStore(openDatabase(':memory:'), join(tempDir(), 'media'))
  const seen: { html: string; width: number; height: number }[] = []
  const tool = renderImageTool(
    {
      render: async (html, size) => {
        seen.push({ html, ...size })
        return renderer.render(html, size)
      }
    },
    media,
    (m) => ({ mediaType: 'image/png', data: `model-${m.id}` })
  )
  const run = (input: unknown) => callTool([tool], 'render_image', input)
  return { media, seen, run }
}

describe('render_image', () => {
  it('renders at 1200x675 by default, saves the PNG and returns its id and the image', async () => {
    const { media, seen, run } = setup()
    const out = await run({ html: '<svg></svg>' })

    expect(out.isError).toBe(false)
    expect(seen).toEqual([{ html: '<svg></svg>', width: 1200, height: 675 }])
    const body = JSON.parse(out.content) as { media_id: string; width: number }
    expect(body.width).toBe(1200)
    expect(out.result).toMatchObject({
      kind: 'render',
      mediaId: body.media_id,
      width: 1200,
      height: 675,
      bytes: PNG.length,
      url: expect.stringMatching(/\.png$/)
    })
    expect(out.image).toEqual({ mediaType: 'image/png', data: `model-${body.media_id}` })
    expect(media.pathOf(body.media_id)).toMatch(/\.png$/)
  })

  it('takes a size, and refuses sizes and html it cannot use', async () => {
    const { seen, run } = setup()
    await run({ html: '<p>x</p>', width: 1080, height: 1080 })
    expect(seen[0]).toMatchObject({ width: 1080, height: 1080 })

    const cases: [unknown, RegExp][] = [
      [{ html: '' }, /non-empty/],
      [{ html: 'x', width: 5000 }, /between 100 and 4000/],
      [{ html: 'x', height: 10.5 }, /whole number/],
      [{ html: 'x'.repeat(500_001) }, /Simplify/]
    ]
    for (const [input, message] of cases) {
      const out = await run(input)
      expect(out.isError).toBe(true)
      expect(out.content).toMatch(message)
    }
  })

  it("refuses a render over X's 5 MB when it is made, and saves nothing", async () => {
    const { media, run } = setup({ render: async () => Buffer.alloc(5 * 1024 * 1024 + 1) })
    const out = await run({ html: '<p>huge</p>', width: 4000, height: 4000 })
    expect(out.isError).toBe(true)
    expect(out.content).toMatch(/5\.0 MB and X takes images up to 5 MB\. Render it smaller/)
    expect(out.result).toBeUndefined()
    expect(media.sweep()).toBe(0)
  })

  it('returns a render failure to the model as an error it can act on', async () => {
    const { media, run } = setup({
      render: async () => {
        throw new RenderError('The render took over 5 seconds. Simplify the HTML and try again.')
      }
    })
    const out = await run({ html: '<p>slow</p>' })
    expect(out.isError).toBe(true)
    expect(out.content).toMatch(/over 5 seconds/)
    expect(media.sweep()).toBe(0)
  })
})
