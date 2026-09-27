import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const app = vi.hoisted(() => ({
  isPackaged: true,
  getLoginItemSettings: vi.fn(),
  setLoginItemSettings: vi.fn()
}))
vi.mock('electron', () => ({ app }))

import {
  HIDDEN_ARG,
  autostartEntry,
  getOpenAtLogin,
  setOpenAtLogin,
  startedAtLogin,
  upgradeLoginItem
} from './loginItem'

const platform = process.platform
const setPlatform = (value: NodeJS.Platform): void => {
  Object.defineProperty(process, 'platform', { value })
}

beforeEach(() => {
  app.isPackaged = true
  app.getLoginItemSettings.mockReset()
  app.setLoginItemSettings.mockReset()
})

afterEach(() => {
  setPlatform(platform)
  vi.unstubAllEnvs()
})

describe('startedAtLogin', () => {
  it('is the login item: --hidden on Windows and Linux, wasOpenedAtLogin on macOS', () => {
    expect(
      startedAtLogin({
        platform: 'win32',
        argv: ['OpenCatt.exe', HIDDEN_ARG],
        wasOpenedAtLogin: false
      })
    ).toBe(true)
    expect(
      startedAtLogin({ platform: 'linux', argv: ['opencatt', HIDDEN_ARG], wasOpenedAtLogin: false })
    ).toBe(true)
    expect(startedAtLogin({ platform: 'darwin', argv: ['OpenCatt'], wasOpenedAtLogin: true })).toBe(
      true
    )
  })

  it('opens the window on any other launch', () => {
    expect(
      startedAtLogin({ platform: 'win32', argv: ['OpenCatt.exe'], wasOpenedAtLogin: false })
    ).toBe(false)
    expect(
      startedAtLogin({ platform: 'darwin', argv: ['OpenCatt'], wasOpenedAtLogin: false })
    ).toBe(false)
    // wasOpenedAtLogin is macOS only.
    expect(startedAtLogin({ platform: 'linux', argv: ['opencatt'], wasOpenedAtLogin: true })).toBe(
      false
    )
  })
})

describe('Windows', () => {
  beforeEach(() => setPlatform('win32'))

  it('registers the login item with --hidden', () => {
    setOpenAtLogin(true)
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, args: [HIDDEN_ARG] })
  })

  it('counts an entry from before OP-68 as on, and upgrades it once', () => {
    app.getLoginItemSettings.mockImplementation((o?: { args?: string[] }) => ({
      openAtLogin: !o?.args
    }))
    expect(getOpenAtLogin()).toBe(true)
    upgradeLoginItem()
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, args: [HIDDEN_ARG] })
  })

  it('leaves an up-to-date entry, or none, alone', () => {
    app.getLoginItemSettings.mockReturnValue({ openAtLogin: true })
    upgradeLoginItem()
    app.getLoginItemSettings.mockReturnValue({ openAtLogin: false })
    upgradeLoginItem()
    expect(app.setLoginItemSettings).not.toHaveBeenCalled()
  })
})

describe('Linux', () => {
  let config: string
  const file = (): string => join(config, 'autostart', 'opencat.desktop')

  beforeEach(() => {
    setPlatform('linux')
    config = mkdtempSync(join(tmpdir(), 'opencat-autostart-'))
    vi.stubEnv('XDG_CONFIG_HOME', config)
    vi.stubEnv('APPIMAGE', '/home/u/OpenCatt.AppImage')
  })

  it('writes an autostart entry that starts in the tray', () => {
    setOpenAtLogin(true)
    expect(readFileSync(file(), 'utf8')).toBe(autostartEntry('/home/u/OpenCatt.AppImage'))
    expect(readFileSync(file(), 'utf8')).toContain('Exec="/home/u/OpenCatt.AppImage" --hidden')
    setOpenAtLogin(false)
    expect(existsSync(file())).toBe(false)
  })

  it('rewrites an entry from before OP-68, and leaves a current one alone', () => {
    mkdirSync(join(config, 'autostart'), { recursive: true })
    writeFileSync(file(), '[Desktop Entry]\nExec="/old/OpenCatt.AppImage"\n')
    upgradeLoginItem()
    expect(readFileSync(file(), 'utf8')).toContain(`Exec="/home/u/OpenCatt.AppImage" ${HIDDEN_ARG}`)

    writeFileSync(file(), autostartEntry('/elsewhere/OpenCatt.AppImage'))
    upgradeLoginItem()
    expect(readFileSync(file(), 'utf8')).toContain('/elsewhere/OpenCatt.AppImage')
  })

  it('does nothing without an entry, or in a dev build', () => {
    upgradeLoginItem()
    expect(existsSync(file())).toBe(false)
    app.isPackaged = false
    setOpenAtLogin(true)
    expect(existsSync(file())).toBe(false)
  })
})
