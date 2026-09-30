import type { PostMedia } from '@shared/api'
import { PLATFORM_RULES, type PlatformRules } from '@shared/platforms'
import type { ModelImage } from '../images'
import { ToolInputError, type PostTool } from '../tools'
import { LANDSCAPE_BOX, PORTRAIT_BOX } from '../../media/video'
import CONTRACT from './hyperframes/contract.md?raw'
import { hyperframesRoot, isHyperframes } from './hyperframes/page'
import { assetsInput, unplacedAssets, type AssetSource, type RenderAssets } from './assets'
import { RenderError, type RenderSize } from './tool'

export const VIDEO_FPS = 30
export const MAX_VIDEO_SECONDS = 60
/** Recordings one turn may make (OP-91): each takes as long as the video, and redoes add up. */
export const MAX_RECORDINGS_PER_TURN = 3

/** How many recordings the running turn has made. */
export interface RecordingCount {
  used(): number
  add(): void
}
export const VIDEO_PRESETS = {
  landscape: { width: 1280, height: 720 },
  square: { width: 1080, height: 1080 }
} as const
const MAX_VIDEO_SIDE = 1920
const MIN_VIDEO_SIDE = 200
const MAX_HTML_CHARS = 500_000

export interface VideoSpec extends RenderSize {
  seconds: number
}

export interface Recording {
  /** The MP4, written where the media store can take it over. */
  path: string
  /** The middle frame as a PNG, for the model to check its work. */
  poster: Buffer
  /** How long it came out: the spec's length, or a HyperFrames root's data-duration. */
  seconds: number
}

/** Plays a composition frame by frame and encodes it. In the app: an offscreen window and ffmpeg. */
export interface VideoRecorder {
  /** `assets` are the user's files the page may load as asset://<media id> (OP-89). */
  record(
    html: string,
    spec: VideoSpec,
    signal: AbortSignal,
    assets?: RenderAssets
  ): Promise<Recording>
}

function side(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ToolInputError(`${field} must be a whole number of pixels`)
  }
  if (value < MIN_VIDEO_SIDE || value > MAX_VIDEO_SIDE) {
    throw new ToolInputError(`${field} must be between ${MIN_VIDEO_SIDE} and ${MAX_VIDEO_SIDE}`)
  }
  // H.264 in yuv420p needs even sides.
  if (value % 2 !== 0) throw new ToolInputError(`${field} must be an even number`)
  return value
}

/**
 * render_video (OP-35): the agent writes an animated HTML composition and gets back an MP4 X
 * takes, as a media id it can attach, plus the middle frame to look at.
 */
export function renderVideoTool(
  recorder: VideoRecorder,
  media: {
    import(
      path: string,
      video: { width: number; height: number; durationMs: number; owned: true }
    ): PostMedia
  },
  /** The running turn's Stop; recording ends when it fires. */
  signal: () => AbortSignal | null,
  toModel: (png: Buffer) => ModelImage | null,
  /** The user's attachments the composition may place as they are (OP-89). */
  assets?: AssetSource,
  recordings?: RecordingCount,
  /** The rules of the account the turn writes for (OP-122): its size and length; X's by default. */
  rules: () => PlatformRules = () => PLATFORM_RULES.x
): PostTool {
  return {
    name: 'render_video',
    description:
      'Record a short video for a post from a HyperFrames composition: one HTML page with a ' +
      'data-composition-id root and a paused GSAP timeline, written to the contract below. ' +
      `Up to ${MAX_VIDEO_SECONDS} seconds at ${VIDEO_FPS} fps, silent. The default size follows ` +
      'the account: 1280x720 for X (or 1080x1080 square), and 1080x1920 vertical for TikTok, ' +
      `where a video runs at least ${PLATFORM_RULES.tiktok.video.minSeconds} seconds. ` +
      "Set width and height to the root's data-width and data-height, and " +
      'seconds to its data-duration. You get back a media_id and the middle frame; attach the ' +
      'video with create_posts or update_post like any file. Recording takes about as long as ' +
      "the video, so don't redo it without a reason. Only when the user asks for a video or " +
      'picks Generate video: a file they attached goes on the post as it is. To use one of ' +
      'their files in the video, like a logo, a photo or footage, list its media id in assets ' +
      'and place it with <img src="asset://MEDIA_ID"> or <video src="asset://MEDIA_ID" muted>; ' +
      'never redraw or imitate it.\n\n' +
      CONTRACT,
    inputSchema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'A full HTML document, sized to width x height.' },
        seconds: { type: 'number', description: `Length, 1 to ${MAX_VIDEO_SECONDS}. Default 15.` },
        width: {
          type: 'integer',
          description: "Pixels, even. Default: the account's size (1280 on X, 1080 on TikTok)."
        },
        height: {
          type: 'integer',
          description: "Pixels, even. Default: the account's size (720 on X, 1920 on TikTok)."
        },
        assets: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Media ids of files the user attached that the video places, each loaded in the ' +
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
      const platform = rules()
      // The platform's own bounds, inside what the recorder can make.
      const shortest = Math.max(1, Math.ceil(platform.video.minSeconds))
      const longest = Math.min(MAX_VIDEO_SECONDS, platform.video.maxSeconds)
      const seconds = args['seconds'] ?? 15
      if (typeof seconds !== 'number' || !(seconds >= shortest && seconds <= longest)) {
        throw new ToolInputError(
          `seconds must be between ${shortest} and ${longest}` +
            (platform.platform === 'x' ? '' : ` for a ${platform.name} video`)
        )
      }
      const size = platform.video.renderSize
      const spec = {
        width: side(args['width'], 'width', size.width),
        height: side(args['height'], 'height', size.height),
        seconds
      }
      // Recordings go straight into the media store, past OP-18's convert, so X's frame limits
      // are checked here rather than when the post goes out. TikTok takes any shape up to 1920.
      const box = spec.height > spec.width ? PORTRAIT_BOX : LANDSCAPE_BOX
      if (platform.platform === 'x' && (spec.width > box.width || spec.height > box.height)) {
        throw new ToolInputError(
          `${spec.width}x${spec.height} is larger than X takes: up to ` +
            `${LANDSCAPE_BOX.width}x${LANDSCAPE_BOX.height} landscape or square, ` +
            `${PORTRAIT_BOX.width}x${PORTRAIT_BOX.height} portrait.`
        )
      }

      const files = assetsInput(args['assets'], assets, ['image', 'gif', 'video'])

      if (isHyperframes(html)) {
        // A root sized differently from the video renders cropped or letterboxed.
        const root = hyperframesRoot(html)
        if (root.width !== spec.width || root.height !== spec.height) {
          throw new ToolInputError(
            `The root's data-width and data-height (${root.width ?? '?'}x${root.height ?? '?'}) ` +
              `must match the video's width and height (${spec.width}x${spec.height}).`
          )
        }
      }

      if ((recordings?.used() ?? 0) >= MAX_RECORDINGS_PER_TURN) {
        throw new ToolInputError(
          `You've recorded ${MAX_RECORDINGS_PER_TURN} videos this turn, the most one turn may ` +
            "make. Attach your best take and tell the user what you'd change; they can ask for " +
            'another recording in their next message.'
        )
      }
      // A recording that fails still took its time, so it counts.
      recordings?.add()
      const left = MAX_RECORDINGS_PER_TURN - (recordings?.used() ?? 0)
      let recording: Recording
      try {
        recording = await recorder.record(
          html,
          spec,
          signal() ?? new AbortController().signal,
          files
        )
      } catch (err) {
        if (err instanceof RenderError) throw new ToolInputError(err.message)
        throw err
      }
      // A HyperFrames root's data-duration decides the length, whatever `seconds` said.
      const durationMs = Math.round(Math.round(recording.seconds * VIDEO_FPS) * (1000 / VIDEO_FPS))
      const saved = media.import(recording.path, {
        width: spec.width,
        height: spec.height,
        durationMs,
        owned: true
      })
      return {
        content: JSON.stringify({
          media_id: saved.id,
          width: spec.width,
          height: spec.height,
          seconds: durationMs / 1000,
          note:
            'Recorded and shown to the user in the chat; the image is its middle frame. Attach ' +
            'it with create_posts or update_post media [{ "id": media_id }]. A video must be ' +
            'the only media in its post.',
          ...(recordings
            ? {
                recordings_left:
                  left === 0
                    ? "That was the last recording this turn. Attach your best take and tell the user what you'd change, rather than recording again."
                    : `${left} of ${MAX_RECORDINGS_PER_TURN} recordings left this turn. Record again only for a real fault you can see in the frame.`
              }
            : {}),
          ...unplacedAssets(assets, html, ['image', 'gif', 'video'])
        }),
        image: toModel(recording.poster) ?? undefined,
        result: {
          kind: 'render',
          mediaId: saved.id,
          width: spec.width,
          height: spec.height,
          bytes: saved.bytes,
          url: saved.url,
          durationMs
        }
      }
    }
  }
}
