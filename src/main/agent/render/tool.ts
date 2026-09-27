import type { PostMedia } from '@shared/api'
import type { ImageLoader } from '../images'
import { ToolInputError, type PostTool } from '../tools'
import { assetsInput, unplacedAssets, type AssetSource, type RenderAssets } from './assets'

export const RENDER_PRESETS = {
  landscape: { width: 1200, height: 675 },
  square: { width: 1080, height: 1080 }
} as const
export const MAX_RENDER_SIDE = 4000
const MIN_RENDER_SIDE = 100
/** X refuses images over 5 MB; a render that big is refused when made, not when it posts. */
export const MAX_RENDER_BYTES = 5 * 1024 * 1024
/** More than any hand-written card needs; stops the model pasting a whole website. */
const MAX_HTML_CHARS = 500_000

export interface RenderSize {
  width: number
  height: number
}

/** Draws self-contained HTML to a PNG. In the app it is an offscreen window with JS and network off. */
export interface HtmlRenderer {
  /** `assets` are the user's files the page may load as asset://<media id> (OP-89). */
  render(html: string, size: RenderSize, assets?: RenderAssets): Promise<Buffer>
}

/** A render that took too long or broke; the model gets the message and can simplify. */
export class RenderError extends Error {
  override name = 'RenderError'
}

function side(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ToolInputError(`${field} must be a whole number of pixels`)
  }
  if (value < MIN_RENDER_SIDE || value > MAX_RENDER_SIDE) {
    throw new ToolInputError(`${field} must be between ${MIN_RENDER_SIDE} and ${MAX_RENDER_SIDE}`)
  }
  return value
}

/**
 * render_image (OP-33): the agent designs an image as HTML or SVG and gets back a media id it can
 * attach with create_posts or update_post, plus the picture itself so it can check its work.
 */
export function renderImageTool(
  renderer: HtmlRenderer,
  media: { importPng(png: Buffer, size: RenderSize): PostMedia },
  /** The render as the model sees it; null leaves the model with the text result only. */
  toModel: ImageLoader,
  /** The user's attachments the design may place as they are (OP-89). */
  assets?: AssetSource
): PostTool {
  return {
    name: 'render_image',
    description:
      'Draw an image for a post from self-contained HTML or SVG, like a quote card, a simple ' +
      'graphic, a chart or a text layout. It renders with JavaScript and the network off, so ' +
      'put all CSS inline or in a <style> tag and use system fonts (system-ui, Georgia, ' +
      'Helvetica, Menlo) or fonts and images embedded as data: URLs. Size the page to exactly ' +
      'the image size. The default is 1200x675, which X shows uncropped; 1080x1080 is square. ' +
      'You get back a media_id and the image. Look at it, and render again if anything is off. ' +
      'Attach it to a post by passing that id in create_posts or update_post media. The user ' +
      'sees each render in the chat. Only when the user asks for an image or picks Generate ' +
      'image: a file they attached goes on the post as it is. To use one of their files in the ' +
      'design, like a logo or a photo, list its media id in assets and place it with ' +
      '<img src="asset://MEDIA_ID">; never redraw or imitate it in SVG or CSS.',
    inputSchema: {
      type: 'object',
      properties: {
        html: {
          type: 'string',
          description: 'A full HTML document or an <svg> element, sized to width x height.'
        },
        width: { type: 'integer', description: 'Pixels, default 1200.' },
        height: { type: 'integer', description: 'Pixels, default 675.' },
        assets: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Media ids of images the user attached that the design places, each loaded in the ' +
            'HTML as asset://<media_id>.'
        }
      },
      required: ['html'],
      additionalProperties: false
    },
    async run(input) {
      if (typeof input !== 'object' || input === null) {
        throw new ToolInputError('Input must be an object')
      }
      const args = input as Record<string, unknown>
      const html = args['html']
      if (typeof html !== 'string' || html.trim() === '') {
        throw new ToolInputError('html must be a non-empty string')
      }
      if (html.length > MAX_HTML_CHARS) {
        throw new ToolInputError(`html is over ${MAX_HTML_CHARS} characters. Simplify it.`)
      }
      const size = {
        width: side(args['width'], 'width', RENDER_PRESETS.landscape.width),
        height: side(args['height'], 'height', RENDER_PRESETS.landscape.height)
      }

      const files = assetsInput(args['assets'], assets, ['image', 'gif'])
      let png: Buffer
      try {
        png = await renderer.render(html, size, files)
      } catch (err) {
        if (err instanceof RenderError) throw new ToolInputError(err.message)
        throw err
      }
      if (png.length > MAX_RENDER_BYTES) {
        const mb = (png.length / (1024 * 1024)).toFixed(1)
        throw new ToolInputError(
          `The render is ${mb} MB and X takes images up to 5 MB. Render it smaller, or with ` +
            'fewer gradients, photos and fine detail, and try again.'
        )
      }
      const saved = media.importPng(png, size)
      return {
        content: JSON.stringify({
          media_id: saved.id,
          width: size.width,
          height: size.height,
          note:
            'Rendered and shown to the user in the chat. Attach it with create_posts or ' +
            'update_post media [{ "id": media_id, "alt": "..." }].',
          ...unplacedAssets(assets, files, ['image', 'gif'])
        }),
        image: toModel(saved) ?? undefined,
        result: {
          kind: 'render',
          mediaId: saved.id,
          width: size.width,
          height: size.height,
          bytes: saved.bytes,
          url: saved.url
        }
      }
    }
  }
}
