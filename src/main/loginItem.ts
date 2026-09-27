import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'

// Electron's login item settings only work on macOS and Windows. On Linux we write an XDG
// autostart entry ourselves, pointing at the AppImage when there is one.
//
// A start at login opens only the tray (OP-68): Windows and Linux pass HIDDEN_ARG, and macOS
// tells us through wasOpenedAtLogin, since its login items can't carry arguments.

/** The argument a login item starts OpenCatt with, so it opens in the tray only. */
export const HIDDEN_ARG = '--hidden'

function linuxAutostartFile(): string {
  const config = process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config')
  return join(config, 'autostart', 'opencat.desktop')
}

/** The XDG autostart entry for `exec`, started in the tray. */
export function autostartEntry(exec: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=OpenCatt',
    `Exec="${exec}" ${HIDDEN_ARG}`,
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

/** Whether this launch came from the login item, so the window stays closed. */
export function startedAtLogin(o: {
  platform: NodeJS.Platform
  argv: string[]
  wasOpenedAtLogin: boolean
}): boolean {
  if (o.argv.includes(HIDDEN_ARG)) return true
  return o.platform === 'darwin' && o.wasOpenedAtLogin
}

export function openedAtLogin(): boolean {
  return startedAtLogin({
    platform: process.platform,
    argv: process.argv,
    wasOpenedAtLogin:
      process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin === true
  })
}

export function getOpenAtLogin(): boolean {
  if (process.platform === 'linux') return existsSync(linuxAutostartFile())
  if (process.platform === 'win32') {
    // The entry from before OP-68 has no argument, so it counts too until it's upgraded.
    return (
      app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin ||
      app.getLoginItemSettings().openAtLogin
    )
  }
  return app.getLoginItemSettings().openAtLogin
}

export function setOpenAtLogin(openAtLogin: boolean): void {
  // A dev build would register the bare Electron binary, which is never what anyone wants.
  if (!app.isPackaged) return
  if (process.platform === 'win32') {
    // One registry value per app name: this replaces an argless entry from before OP-68.
    app.setLoginItemSettings({ openAtLogin, args: [HIDDEN_ARG] })
    return
  }
  if (process.platform !== 'linux') {
    app.setLoginItemSettings({ openAtLogin })
    return
  }
  const file = linuxAutostartFile()
  if (!openAtLogin) {
    rmSync(file, { force: true })
    return
  }
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, autostartEntry(process.env['APPIMAGE'] || process.execPath))
}

/**
 * Login items made before OP-68 start without HIDDEN_ARG and so open the window. Rewrites them
 * once so the next login starts in the tray. macOS needs nothing: it has no arguments.
 */
export function upgradeLoginItem(): void {
  if (!app.isPackaged) return
  if (process.platform === 'win32') {
    if (
      app.getLoginItemSettings().openAtLogin &&
      !app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin
    ) {
      setOpenAtLogin(true)
    }
    return
  }
  if (process.platform !== 'linux') return
  const file = linuxAutostartFile()
  if (!existsSync(file)) return
  if (!readFileSync(file, 'utf8').includes(HIDDEN_ARG)) setOpenAtLogin(true)
}
