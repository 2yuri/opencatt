import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const setBadgeCount = vi.fn()
const createFromBitmap = vi.fn((buffer: Buffer) => ({ buffer }))
vi.mock('electron', () => ({
  app: { setBadgeCount: (n: number) => setBadgeCount(n) },
  nativeImage: { createFromBitmap: (b: Buffer) => createFromBitmap(b) }
}))

const { badgeText, showPendingBadge } = await import('./badge')

const windowWith = (setOverlayIcon = vi.fn()): BrowserWindow =>
  ({ setOverlayIcon }) as unknown as BrowserWindow

beforeEach(() => {
  setBadgeCount.mockClear()
  createFromBitmap.mockClear()
})

describe('showPendingBadge', () => {
  it('puts the number on the Dock and Linux docks, and clears it at 0', () => {
    showPendingBadge(3, [], 'darwin')
    showPendingBadge(0, [], 'linux')
    expect(setBadgeCount.mock.calls).toEqual([[3], [0]])
  })

  it('puts a dot over the taskbar button on Windows, with the count for screen readers', () => {
    const overlay = vi.fn()
    showPendingBadge(2, [windowWith(overlay)], 'win32')
    expect(overlay).toHaveBeenCalledWith(expect.anything(), '2 posts waiting for approval')
    const [buffer] = createFromBitmap.mock.calls[0]!
    expect(buffer.length).toBe(16 * 16 * 4)
    showPendingBadge(0, [windowWith(overlay)], 'win32')
    expect(overlay).toHaveBeenLastCalledWith(null, '')
    expect(setBadgeCount).not.toHaveBeenCalled()
  })

  it('says one post in the singular', () => {
    expect(badgeText(1)).toBe('1 post waiting for approval')
  })
})
