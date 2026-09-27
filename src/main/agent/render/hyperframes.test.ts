import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { tempDir } from '../../media/testFiles'
import { gsapLoader, GSAP_URL } from './gsap'
import { hyperframesRoot, isHyperframes, withHyperframes } from './hyperframes/page'

const hash = (text: string): string => createHash('sha384').update(text).digest('base64')

describe('gsapLoader', () => {
  it('downloads the pinned file once, checks it and serves the cached copy after', async () => {
    const dir = tempDir()
    const download = vi.fn(async () => Buffer.from('window.gsap = {}'))
    const load = gsapLoader(dir, download, hash('window.gsap = {}'))

    expect(await load()).toBe('window.gsap = {}')
    expect(download).toHaveBeenCalledWith(GSAP_URL)
    const again = gsapLoader(dir, download, hash('window.gsap = {}'))
    expect(await again()).toBe('window.gsap = {}')
    expect(download).toHaveBeenCalledTimes(1)
    expect(readFileSync(join(dir, 'gsap-3.15.0.min.js'), 'utf8')).toBe('window.gsap = {}')
  })

  it('refuses a file that does not match, and keeps nothing', async () => {
    const dir = tempDir()
    const load = gsapLoader(dir, async () => Buffer.from('tampered'), hash('the real one'))
    await expect(load()).rejects.toThrow(/didn't match the expected file/)
    expect(existsSync(join(dir, 'gsap-3.15.0.min.js'))).toBe(false)
  })

  it('says the first video needs a connection when offline, and tries again next time', async () => {
    const download = vi
      .fn<(url: string) => Promise<Buffer>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Buffer.from('ok'))
    const load = gsapLoader(tempDir(), download, hash('ok'))
    await expect(load()).rejects.toThrow(/first video needs an internet connection/)
    expect(await load()).toBe('ok')
  })
})

describe('HyperFrames page', () => {
  const composition =
    '<html><head><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script></head>' +
    '<body><div id="root" data-composition-id="main" data-width="1280" data-height="720" data-duration="12"></div>' +
    '<script>window.__timelines["main"] = gsap.timeline({ paused: true })</script></body></html>'

  it('recognises a composition and reads its root', () => {
    expect(isHyperframes(composition)).toBe(true)
    expect(isHyperframes('<p>plain</p>')).toBe(false)
    expect(hyperframesRoot(composition)).toEqual({
      id: 'main',
      width: 1280,
      height: 720,
      duration: 12
    })
  })

  it('puts GSAP and the runtime before the composition and drops external scripts', () => {
    const page = withHyperframes(
      `<html><head><style>html{}</style>${composition.slice(12)}`,
      'window.gsap = "GSAP"'
    )
    expect(page).not.toContain('cdn.jsdelivr.net')
    const gsap = page.indexOf('window.gsap = "GSAP"')
    const runtime = page.indexOf('__HF_RENDER_CAPTURE_MODE')
    expect(runtime).toBeGreaterThan(0)
    expect(gsap).toBeGreaterThan(runtime)
    expect(page.indexOf('window.__timelines["main"]')).toBeGreaterThan(gsap)
  })
})
