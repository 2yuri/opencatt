import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, session: {} }))
const { renderPage } = await import('./offscreen')

describe('renderPage', () => {
  const size = { width: 1200, height: 675 }

  it('wraps bare SVG in a page of exactly the image size, behind a no-script, no-network policy', () => {
    const page = renderPage('<svg viewBox="0 0 10 10"></svg>', size)
    expect(page).toContain("default-src 'none'")
    expect(page).toContain('width:1200px;height:675px')
    expect(page).toContain('<body><svg viewBox="0 0 10 10"></svg></body>')
  })

  it('puts the policy first in an existing head, before anything the page declares', () => {
    const page = renderPage(
      '<html><head><link rel="stylesheet" href="https://x.test/a.css"></head><body>Hi</body></html>',
      size
    )
    expect(page.indexOf('Content-Security-Policy')).toBeLessThan(page.indexOf('<link'))
  })

  it('wraps a fragment in a full page', () => {
    expect(renderPage('<h1>Hi</h1>', size)).toMatch(/^<!doctype html>.*<body><h1>Hi<\/h1><\/body>/s)
  })
})
