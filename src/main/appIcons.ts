import { join } from 'node:path'

// Where the running app finds its own icons. In dev they're read straight from build/; in a
// packaged app electron-builder copies them to resources/icons (extraResources in
// electron-builder.yml), because build/ itself isn't packed.

export interface IconPlaces {
  packaged: boolean
  /** process.resourcesPath in a packaged app. */
  resourcesPath: string
  /** app.getAppPath() in dev: the project root. */
  appPath: string
  platform: NodeJS.Platform
}

/** The window icon. macOS takes it from the bundle's .icns, so it's only set on Windows and Linux. */
export function windowIconPath(p: IconPlaces): string | undefined {
  if (p.platform === 'darwin') return undefined
  return p.packaged
    ? join(p.resourcesPath, 'icons', '256x256.png')
    : join(p.appPath, 'build', 'icons', '256x256.png')
}

/**
 * The tray icon for OP-10. macOS gets the black template image (the "Template" suffix makes
 * Electron mark it so macOS tints it for light and dark menu bars), Windows the .ico, Linux the
 * colour PNG; nativeImage picks up the @2x file next to a PNG by itself.
 */
export function trayIconPath(p: IconPlaces): string {
  const file =
    p.platform === 'darwin' ? 'trayTemplate.png' : p.platform === 'win32' ? 'tray.ico' : 'tray.png'
  return p.packaged ? join(p.resourcesPath, 'icons', file) : join(p.appPath, 'build', file)
}
