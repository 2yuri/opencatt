import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { BrowserWindow, session, type NativeImage, type WebContents } from 'electron'
import { encodeFailureMessage, type FfmpegBinaries } from '../../media/ffmpeg'
import { h264Encoder } from '../../media/video'
import { CLOCK_SCRIPT } from './clock'
import { RenderError } from './tool'
import { hyperframesRoot, isHyperframes, withHyperframes } from './hyperframes/page'
import { serveAssets } from './assetProtocol'
import { NO_ASSETS, renderRequestAllowed, type RenderAssets } from './assets'
import {
  MAX_VIDEO_SECONDS,
  VIDEO_FPS,
  type Recording,
  type VideoRecorder,
  type VideoSpec
} from './videoTool'

/** Past this the recording is given up, whatever its length. */
export const RECORD_TIMEOUT_MS = 120_000
const PARTITION = 'opencat-video'

/** Scripts inline only: no network, no plugins, nothing from outside but the user's files. */
const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' data:; " +
  'img-src data: blob: asset:; font-src data:; media-src data: blob: asset:'

/** The composition as one page of exactly the video's size, behind the policy. */
export function videoPage(
  html: string,
  { width, height }: { width: number; height: number }
): string {
  const head =
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<style>html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden}</style>`
  const trimmed = html.trim()
  if (/<head[^>]*>/i.test(trimmed)) return trimmed.replace(/<head[^>]*>/i, (h) => `${h}${head}`)
  return `<!doctype html><html><head>${head}</head><body>${trimmed}</body></html>`
}

/** ffmpeg reading raw BGRA frames on stdin and writing an MP4 X takes. */
export function recordArgs(spec: VideoSpec, output: string, platform: NodeJS.Platform): string[] {
  return [
    '-hide_banner',
    '-y',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'bgra',
    '-s',
    `${spec.width}x${spec.height}`,
    '-r',
    String(VIDEO_FPS),
    // The minimal build doesn't take "-" for stdin.
    '-i',
    'pipe:0',
    ...h264Encoder(platform),
    '-b:v',
    '6M',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output
  ]
}

/**
 * Records in a hidden offscreen window on an in-memory session: no Node, no preload, every
 * request but data: refused, no navigation or popups. Frames are captured after each clock step
 * and piped to the bundled ffmpeg.
 */
export function offscreenRecorder(
  ffmpeg: () => FfmpegBinaries,
  tempPath: () => string,
  /** GSAP's source, for HyperFrames compositions (OP-81). */
  gsap: () => Promise<string> = () => Promise.reject(new RenderError('GSAP is not available.')),
  platform: NodeJS.Platform = process.platform
): VideoRecorder {
  const ses = session.fromPartition(PARTITION, { cache: false })
  // The files of the recording in progress; recordings run one at a time.
  let assets: RenderAssets = NO_ASSETS
  serveAssets(ses, () => assets)
  ses.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !renderRequestAllowed(details.url, assets) })
  )
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  return {
    async record(html, spec, signal, files = NO_ASSETS) {
      assets = files
      const { ffmpeg: bin } = ffmpeg()
      const output = tempPath()
      const win = new BrowserWindow({
        show: false,
        width: spec.width,
        height: spec.height,
        useContentSize: true,
        frame: false,
        enableLargerThanScreen: true,
        webPreferences: {
          offscreen: true,
          session: ses,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          spellcheck: false,
          devTools: false,
          backgroundThrottling: false
        }
      })
      const contents = win.webContents
      contents.setFrameRate(60)
      // webRequest doesn't see WebRTC, so no UDP outside a proxy: the page can't learn the IP.
      contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
      contents.on('will-navigate', (e) => e.preventDefault())
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const frames = paints(contents)

      const encoder = spawn(bin, recordArgs(spec, output, platform), {
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true
      })
      let stderr = ''
      encoder.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000)
      })
      const exited = new Promise<number | null>((resolve) => {
        encoder.once('error', () => resolve(-1))
        encoder.once('close', (code) => resolve(code))
      })
      encoder.stdin.on('error', () => {})

      let timer: NodeJS.Timeout | undefined
      const stop = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new RenderError(
                `The recording took over ${RECORD_TIMEOUT_MS / 60_000} minutes. Make it shorter or simpler.`
              )
            ),
          RECORD_TIMEOUT_MS
        )
        const onAbort = (): void => reject(new RenderError('Stopped.'))
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
        void exited.then((code) => {
          if (code !== 0) reject(new RenderError(encodeFailureMessage(platform, stderr)))
        })
      })
      const race = <T>(p: Promise<T>): Promise<T> => Promise.race([p, stop])

      try {
        // The debugger only answers once something has loaded.
        await race(contents.loadURL('about:blank'))
        const dbg = contents.debugger
        dbg.attach('1.3')
        await race(dbg.sendCommand('Page.enable'))
        // A HyperFrames composition (OP-81) is seeked through its runtime; anything else runs on
        // OP-35's virtual clock.
        const hyper = isHyperframes(html)
        if (!hyper) {
          await race(
            dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK_SCRIPT })
          )
        }
        let page = videoPage(html, spec)
        if (hyper) page = withHyperframes(page, await race(gsap()))
        await race(
          contents.loadURL(
            `data:text/html;charset=utf-8;base64,${Buffer.from(page).toString('base64')}`
          )
        )

        const seconds = hyper
          ? await race(hyperframesReady(contents, hyperframesRoot(html)))
          : spec.seconds
        const count = Math.round(seconds * VIDEO_FPS)
        let poster: Buffer | null = null
        for (let i = 0; i < count; i++) {
          await race(
            contents.executeJavaScript(
              hyper ? hyperframesStep(i / VIDEO_FPS) : `window.__ocStep(${(i * 1000) / VIDEO_FPS})`
            )
          )
          let image = await race(frames.next())
          const drawn = image.getSize()
          if (drawn.width !== spec.width || drawn.height !== spec.height) {
            // Offscreen frames come at the display's scale.
            image = image.resize({ width: spec.width, height: spec.height, quality: 'good' })
          }
          if (i === Math.floor(count / 2)) poster = image.toPNG()
          if (!encoder.stdin.write(image.toBitmap())) {
            await race(new Promise((resolve) => encoder.stdin.once('drain', resolve)))
          }
        }
        encoder.stdin.end()
        const code = await race(exited)
        if (code !== 0) throw new RenderError(encodeFailureMessage(platform, stderr))
        return { path: output, poster: poster ?? Buffer.alloc(0), seconds } satisfies Recording
      } catch (err) {
        encoder.kill('SIGKILL')
        rmSync(output, { force: true })
        if (err instanceof RenderError) throw err
        throw new RenderError(
          `The composition couldn't be recorded: ${err instanceof Error ? err.message : String(err)}`
        )
      } finally {
        clearTimeout(timer)
        frames.stop()
        if (!win.isDestroyed()) win.destroy()
        assets = NO_ASSETS
        void ses.clearStorageData().catch(() => {})
      }
    }
  }
}

/** Past this a HyperFrames page that never reports ready is given up. */
const HYPERFRAMES_READY_MS = 10_000

/**
 * Waits for the HyperFrames runtime to bind the composition's timeline, the check HyperFrames' own
 * renderer makes, and returns the length to record: the root's data-duration, else the runtime's.
 */
async function hyperframesReady(
  contents: WebContents,
  root: { id: string | null; duration: number | null }
): Promise<number> {
  const started = Date.now()
  let waitedForTimeline = false
  for (;;) {
    const duration = (await contents.executeJavaScript(
      `(window.__renderReady && window.__player && typeof window.__player.renderSeek === 'function')
        ? window.__player.getDuration() : 0`
    )) as number
    if (duration > 0) {
      // The runtime is ready on data-duration alone; without the timeline every frame would be
      // the first one, so this is caught here rather than recorded.
      const bound = (await contents.executeJavaScript(
        `Boolean(window.__timelines && window.__timelines[${JSON.stringify(root.id ?? '')}])`
      )) as boolean
      // A timeline built inside document.fonts.ready (which the contract allows) lands a moment
      // after the runtime is ready, so it gets until the deadline before this is an error.
      if (!bound && Date.now() - started <= HYPERFRAMES_READY_MS) {
        waitedForTimeline = true
        await new Promise((resolve) => setTimeout(resolve, 50))
        continue
      }
      if (bound && waitedForTimeline) {
        // Registered late: have the runtime bind it, as the contract says to after an async build.
        await contents.executeJavaScript(
          `typeof window.__hfForceTimelineRebind === 'function' && window.__hfForceTimelineRebind()`
        )
      }
      if (!bound) {
        throw new RenderError(
          `No GSAP timeline is registered at window.__timelines["${root.id ?? ''}"], so the video ` +
            'would not move. Build one gsap.timeline({ paused: true }) and assign it there, with ' +
            'the key equal to the root data-composition-id, after all tweens are added.'
        )
      }
      const declared = root.duration
      const seconds = declared && declared > 0 ? declared : duration
      if (seconds > MAX_VIDEO_SECONDS) {
        throw new RenderError(
          `The composition is ${seconds} seconds long; videos can be up to ${MAX_VIDEO_SECONDS}. ` +
            'Lower the root data-duration.'
        )
      }
      return seconds
    }
    if (Date.now() - started > HYPERFRAMES_READY_MS) {
      throw new RenderError(
        'The HyperFrames composition never became ready. Check that the root has ' +
          'data-composition-id, data-width, data-height and data-duration, and that the paused ' +
          'GSAP timeline is registered at window.__timelines["<that id>"] after it is built.'
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** One frame through the runtime, as HyperFrames' renderer does it, then two real frames to paint. */
function hyperframesStep(seconds: number): string {
  return `(async () => {
    window.__player.renderSeek(${seconds});
    if (typeof window.__hfWaitForSeekCompletion === 'function') await window.__hfWaitForSeekCompletion();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return true;
  })()`
}

/** Painted frames on demand: invalidate, then the next non-empty paint. */
function paints(contents: WebContents): { next(): Promise<NativeImage>; stop(): void } {
  let waiting: ((image: NativeImage) => void) | null = null
  const onPaint = (_e: unknown, _dirty: unknown, image: NativeImage): void => {
    if (!waiting || image.isEmpty()) return
    const resolve = waiting
    waiting = null
    resolve(image)
  }
  contents.on('paint', onPaint)
  return {
    next: () =>
      new Promise<NativeImage>((resolve) => {
        waiting = resolve
        contents.invalidate()
      }),
    stop: () => {
      if (!contents.isDestroyed()) contents.off('paint', onPaint)
    }
  }
}
