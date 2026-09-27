import { Menu, Notification, Tray, nativeImage } from 'electron'
import type { SettingsStore } from './db'

const TOLD_KEY = 'tray.toldUser'

/**
 * The tray (menu bar on macOS) icon that keeps OpenCatt reachable while its window is closed,
 * so the publisher (OP-10) can post on time.
 */
export function createTray(o: { iconPath: string; onOpen: () => void; onQuit: () => void }): Tray {
  const image = nativeImage.createFromPath(o.iconPath)
  const tray = new Tray(image)
  tray.setToolTip('OpenCatt')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open OpenCatt', click: o.onOpen },
      { type: 'separator' },
      { label: 'Quit OpenCatt', click: o.onQuit }
    ])
  )
  // Windows and Linux open the window on a click; macOS shows the menu.
  if (process.platform !== 'darwin') tray.on('click', o.onOpen)
  return tray
}

/** Says once, the first time the window closes, that OpenCatt is still running. */
export function tellAboutTrayOnce(settings: SettingsStore): void {
  if (settings.get(TOLD_KEY) === true || !Notification.isSupported()) return
  settings.set(TOLD_KEY, true)
  const where = process.platform === 'darwin' ? 'menu bar' : 'tray'
  new Notification({
    title: 'OpenCatt is still running',
    body: `It stays in the ${where} so your posts go out on time. Quit it from the ${where} icon.`
  }).show()
}
