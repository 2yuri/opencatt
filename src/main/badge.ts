import { app, nativeImage, type BrowserWindow, type NativeImage } from 'electron'

const DOT_SIZE = 16

/** An amber dot for the Windows taskbar, drawn pixel by pixel: nativeImage can't read SVG there. */
function dot(): NativeImage {
  const pixels = Buffer.alloc(DOT_SIZE * DOT_SIZE * 4)
  const r = DOT_SIZE / 2
  for (let y = 0; y < DOT_SIZE; y++) {
    for (let x = 0; x < DOT_SIZE; x++) {
      if ((x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 > r * r) continue
      const i = (y * DOT_SIZE + x) * 4
      // BGRA: #E3A33B
      pixels[i] = 0x3b
      pixels[i + 1] = 0xa3
      pixels[i + 2] = 0xe3
      pixels[i + 3] = 0xff
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: DOT_SIZE, height: DOT_SIZE })
}

export const badgeText = (count: number): string =>
  count === 1 ? '1 post waiting for approval' : `${count} posts waiting for approval`

/**
 * Shows how many posts wait for approval on the app icon: the number on the macOS Dock and Linux
 * docks that support it, a dot over the taskbar button on Windows. Nothing at 0.
 */
export function showPendingBadge(
  count: number,
  windows: BrowserWindow[],
  platform: NodeJS.Platform = process.platform
): void {
  if (platform === 'win32') {
    const overlay = count > 0 ? dot() : null
    for (const window of windows) window.setOverlayIcon(overlay, count > 0 ? badgeText(count) : '')
    return
  }
  app.setBadgeCount(count)
}
