import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { trayIconPath, windowIconPath } from './appIcons'

const dev = { packaged: false, resourcesPath: '/r', appPath: '/proj' }
const packed = { packaged: true, resourcesPath: '/r', appPath: '/r/app.asar' }

describe('appIcons', () => {
  it('sets a window icon only where the OS takes it from the window', () => {
    expect(windowIconPath({ ...dev, platform: 'darwin' })).toBeUndefined()
    expect(windowIconPath({ ...dev, platform: 'linux' })).toBe(
      join('/proj', 'build', 'icons', '256x256.png')
    )
    expect(windowIconPath({ ...packed, platform: 'win32' })).toBe(
      join('/r', 'icons', '256x256.png')
    )
  })

  it('picks the tray file each OS wants, from build/ in dev and resources/icons when packaged', () => {
    expect(trayIconPath({ ...dev, platform: 'darwin' })).toBe(
      join('/proj', 'build', 'trayTemplate.png')
    )
    expect(trayIconPath({ ...packed, platform: 'darwin' })).toBe(
      join('/r', 'icons', 'trayTemplate.png')
    )
    expect(trayIconPath({ ...packed, platform: 'win32' })).toBe(join('/r', 'icons', 'tray.ico'))
    expect(trayIconPath({ ...packed, platform: 'linux' })).toBe(join('/r', 'icons', 'tray.png'))
  })
})
