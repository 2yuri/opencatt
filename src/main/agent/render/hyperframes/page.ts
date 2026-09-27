import RUNTIME from './runtime.iife.js?raw'

/** A composition the HyperFrames runtime can seek: a root with data-composition-id (OP-81). */
export function isHyperframes(html: string): boolean {
  return /\bdata-composition-id\s*=/i.test(html)
}

/** The root's id, declared size and length, when present. */
export function hyperframesRoot(html: string): {
  id: string | null
  width: number | null
  height: number | null
  duration: number | null
} {
  const root = /<[^>]*\bdata-composition-id\s*=[^>]*>/i.exec(html)?.[0] ?? ''
  const num = (name: string): number | null => {
    const m = new RegExp(`\\bdata-${name}\\s*=\\s*["']?([0-9.]+)`, 'i').exec(root)
    return m ? Number(m[1]) : null
  }
  const id = /\bdata-composition-id\s*=\s*["']([^"']*)["']/i.exec(root)?.[1] ?? null
  return { id, width: num('width'), height: num('height'), duration: num('duration') }
}

const inline = (source: string): string =>
  `<script>${source.replace(/<\/script/gi, '<\\/script')}</script>`

/**
 * The page HyperFrames' own renderer builds: render-capture mode on, GSAP and the runtime in the
 * head before the composition's scripts. External scripts (the GSAP <script src> in HyperFrames'
 * examples) are dropped, since GSAP is already there and the page has no network.
 */
export function withHyperframes(page: string, gsap: string): string {
  const scripts =
    '<script>globalThis.__HF_RENDER_CAPTURE_MODE = true;</script>' + inline(gsap) + inline(RUNTIME)
  const stripped = page.replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, '')
  // After the policy and size the page already carries, before anything the composition declares.
  return stripped.replace(/<\/style>/i, (end) => `${end}${scripts}`)
}
