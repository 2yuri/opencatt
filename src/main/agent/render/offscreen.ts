import { BrowserWindow, session, type NativeImage } from 'electron'
import { serveAssets } from './assetProtocol'
import { NO_ASSETS, renderRequestAllowed, type RenderAssets } from './assets'
import { RenderError, type HtmlRenderer, type RenderSize } from './tool'

/** Past this the render is given up and the model is told to simplify. */
export const RENDER_TIMEOUT_MS = 5000
/** Room for layout and system fonts to settle after load; there is no JS to wait on. */
const SETTLE_MS = 150
const PARTITION = 'opencat-render'

/** No script, no network, no plugins: the page draws what it carries and the user's files. */
const CSP =
  "default-src 'none'; style-src 'unsafe-inline' data:; img-src data: asset:; font-src data:; " +
  'media-src data: asset:'

/** The model's HTML or bare SVG as one page the exact size of the image. */
export function renderPage(html: string, { width, height }: RenderSize): string {
  const csp = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`
  const frame =
    `<style>html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden}` +
    `body>svg:only-child{display:block;width:${width}px;height:${height}px}</style>`
  const trimmed = html.trim()
  if (/^<svg[\s>]/i.test(trimmed)) {
    return `<!doctype html><html><head><meta charset="utf-8">${csp}${frame}</head><body>${trimmed}</body></html>`
  }
  // The policy goes first in <head>, so it holds before anything the page itself declares.
  if (/<head[^>]*>/i.test(trimmed)) {
    return trimmed.replace(/<head[^>]*>/i, (head) => `${head}<meta charset="utf-8">${csp}${frame}`)
  }
  return `<!doctype html><html><head><meta charset="utf-8">${csp}${frame}</head><body>${trimmed}</body></html>`
}

/**
 * Renders in a hidden offscreen window on an in-memory session: JavaScript off, every request
 * but data: refused, no navigation, no popups, and a 5-second limit.
 */
export function offscreenRenderer(): HtmlRenderer {
  const ses = session.fromPartition(PARTITION, { cache: false })
  // The files of the render in progress; renders run one at a time.
  let assets: RenderAssets = NO_ASSETS
  serveAssets(ses, () => assets)
  ses.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !renderRequestAllowed(details.url, assets) })
  )
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  return {
    async render(html, size, files = NO_ASSETS) {
      assets = files
      const win = new BrowserWindow({
        show: false,
        width: size.width,
        height: size.height,
        useContentSize: true,
        frame: false,
        enableLargerThanScreen: true,
        webPreferences: {
          offscreen: true,
          javascript: false,
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
      contents.setFrameRate(10)
      contents.on('will-navigate', (e) => e.preventDefault())
      contents.setWindowOpenHandler(() => ({ action: 'deny' }))
      let latest: NativeImage | null = null
      contents.on('paint', (_e, _dirty, image) => {
        latest = image
      })

      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new RenderError(
                `The render took over ${RENDER_TIMEOUT_MS / 1000} seconds. Simplify the HTML and try again.`
              )
            ),
          RENDER_TIMEOUT_MS
        )
      })
      try {
        const page = renderPage(html, size)
        const url = `data:text/html;charset=utf-8;base64,${Buffer.from(page).toString('base64')}`
        await Promise.race([contents.loadURL(url), timeout])
        await Promise.race([new Promise((r) => setTimeout(r, SETTLE_MS)), timeout])
        contents.invalidate()
        const image = await Promise.race([nextPaint(contents, () => latest), timeout])
        const drawn = image.getSize()
        // Offscreen frames come at the display's scale; the post wants exact pixels.
        const exact =
          drawn.width === size.width && drawn.height === size.height
            ? image
            : image.resize({ width: size.width, height: size.height, quality: 'best' })
        return exact.toPNG()
      } catch (err) {
        if (err instanceof RenderError) throw err
        throw new RenderError(
          `The HTML couldn't be rendered: ${err instanceof Error ? err.message : String(err)}`
        )
      } finally {
        clearTimeout(timer)
        if (!win.isDestroyed()) win.destroy()
        assets = NO_ASSETS
        void ses.clearStorageData().catch(() => {})
      }
    }
  }
}

/** The next painted frame, or the last one if a paint already landed. */
function nextPaint(
  contents: Electron.WebContents,
  latest: () => NativeImage | null
): Promise<NativeImage> {
  return new Promise((resolve) => {
    const onPaint = (_e: unknown, _dirty: unknown, image: NativeImage): void => {
      contents.off('paint', onPaint)
      resolve(image)
    }
    contents.on('paint', onPaint)
    setTimeout(() => {
      const last = latest()
      if (last && !last.isEmpty()) {
        contents.off('paint', onPaint)
        resolve(last)
      }
    }, 300)
  })
}
