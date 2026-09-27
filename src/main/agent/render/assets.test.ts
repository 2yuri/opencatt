import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../db/database'
import { MediaStore } from '../../media/store'
import { fakeMedia, tempDir } from '../../media/testFiles'
import { callTool } from '../tools'
import { assetId, assetsInput, renderRequestAllowed, type AssetSource } from './assets'
import { renderImageTool } from './tool'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])

function setup() {
  const media = new MediaStore(openDatabase(':memory:'), join(tempDir(), 'media'))
  const source = tempDir('opencat-src-')
  const logo = media.import(fakeMedia(source, 'logo.png')).id
  const other = media.import(fakeMedia(source, 'other.png')).id
  const allowed = new Set([logo])
  const attached: string[] = []
  const assets: AssetSource = {
    allowed: () => allowed,
    attached: () => attached,
    lookup: (id) => {
      const m = media.get(id)
      return m ? { kind: m.kind, path: media.pathOf(id) } : null
    }
  }
  return { media, logo, other, allowed, attached, assets }
}

describe('render assets (OP-89)', () => {
  it("takes only the user's attachments, of the kinds the tool can place", () => {
    const { media, logo, other, assets } = setup()
    expect([...assetsInput([logo], assets, ['image']).entries()]).toEqual([
      [logo, media.pathOf(logo)]
    ])
    expect(assetsInput(undefined, assets, ['image']).size).toBe(0)
    expect(() => assetsInput([other], assets, ['image'])).toThrow(
      `assets[0]: ${other} isn't a file the user attached in this chat.`
    )
    expect(() => assetsInput([logo], assets, ['video'])).toThrow('is a image; use video.')
    expect(() => assetsInput('x', assets, ['image'])).toThrow('assets must be an array')
  })

  it('lets a render load data:, about:blank and its own assets, and nothing else', () => {
    const files = new Map([['abc-1', '/m/abc-1.png']])
    expect(assetId('asset://abc-1')).toBe('abc-1')
    expect(assetId('asset://abc-1/')).toBe('abc-1')
    expect(assetId('asset://abc-1/../../etc/passwd')).toBeNull()
    expect(renderRequestAllowed('data:image/png;base64,AA', files)).toBe(true)
    expect(renderRequestAllowed('about:blank', files)).toBe(true)
    expect(renderRequestAllowed('asset://abc-1', files)).toBe(true)
    expect(renderRequestAllowed('asset://abc-2', files)).toBe(false)
    expect(renderRequestAllowed('https://example.com/logo.png', files)).toBe(false)
    expect(renderRequestAllowed('file:///m/abc-1.png', files)).toBe(false)
  })

  it('hands render_image the files it may load, and refuses one the user never gave', async () => {
    const { media, logo, other, assets } = setup()
    const seen: ReadonlyMap<string, string>[] = []
    const tool = renderImageTool(
      {
        render: async (_html, _size, files) => {
          seen.push(files ?? new Map())
          return PNG
        }
      },
      media,
      () => null,
      assets
    )
    const html = `<img src="asset://${logo}">`
    expect((await callTool([tool], 'render_image', { html, assets: [logo] })).isError).toBe(false)
    expect([...seen[0]!.keys()]).toEqual([logo])

    const refused = await callTool([tool], 'render_image', { html, assets: [other] })
    expect(refused.isError).toBe(true)
    expect(seen).toHaveLength(1)
  })

  it("notes a render that places none of the turn's attached files, and not one that does", async () => {
    const { media, logo, attached, assets } = setup()
    attached.push(logo)
    const tool = renderImageTool({ render: async () => PNG }, media, () => null, assets)
    const drawn = await callTool([tool], 'render_image', { html: '<svg></svg>' })
    expect(JSON.parse(drawn.content).attachment_note).toContain(`assets: ["${logo}"]`)

    const placed = await callTool([tool], 'render_image', {
      html: `<img src="asset://${logo}">`,
      assets: [logo]
    })
    expect(JSON.parse(placed.content).attachment_note).toBeUndefined()
  })

  it("lets a render load the turn's attachments even when the model leaves assets out", async () => {
    const { media, logo, attached, assets } = setup()
    attached.push(logo)
    expect([...assetsInput(undefined, assets, ['image']).keys()]).toEqual([logo])
    expect(assetsInput(undefined, assets, ['video']).size).toBe(0)

    const tool = renderImageTool({ render: async () => PNG }, media, () => null, assets)
    const out = await callTool([tool], 'render_image', { html: `<img src="asset://${logo}">` })
    expect(JSON.parse(out.content).attachment_note).toBeUndefined()
  })
})
