import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'

// The ffmpeg and ffprobe OpenCatt ships (OP-62): LGPL builds from scripts/ffmpeg/, one set per
// platform. Packaged, they sit in resources/ffmpeg, outside the asar so they can run; in dev,
// in vendor/ffmpeg/<platform>-<arch>/, which scripts/ffmpeg/fetch.sh fills.

export interface FfmpegPlaces {
  packaged: boolean
  /** process.resourcesPath in a packaged app. */
  resourcesPath: string
  /** app.getAppPath() in dev: the project root. */
  appPath: string
  platform: NodeJS.Platform
  arch: string
}

export interface FfmpegBinaries {
  ffmpeg: string
  ffprobe: string
}

/** The video tools are missing or can't run; the message is for the user. */
export class FfmpegMissingError extends Error {
  override name = 'FfmpegMissingError'
}

export function ffmpegDir(p: FfmpegPlaces): string {
  return p.packaged
    ? join(p.resourcesPath, 'ffmpeg')
    : join(p.appPath, 'vendor', 'ffmpeg', `${p.platform}-${p.arch}`)
}

export function ffmpegPaths(p: FfmpegPlaces): FfmpegBinaries {
  const exe = p.platform === 'win32' ? '.exe' : ''
  const dir = ffmpegDir(p)
  return { ffmpeg: join(dir, `ffmpeg${exe}`), ffprobe: join(dir, `ffprobe${exe}`) }
}

/**
 * The paths, once both binaries are there and executable. OP-18 and OP-35 call this before
 * spawning, so a broken install fails with a message rather than a spawn ENOENT.
 */
export function requireFfmpeg(
  p: FfmpegPlaces,
  canRun: (path: string) => boolean = executable
): FfmpegBinaries {
  const paths = ffmpegPaths(p)
  for (const path of [paths.ffmpeg, paths.ffprobe]) {
    if (!canRun(path)) {
      throw new FfmpegMissingError(
        p.packaged
          ? 'OpenCatt’s video tools are missing from this install. Reinstall OpenCatt to fix it.'
          : `No ffmpeg at ${path}. Run scripts/ffmpeg/fetch.sh first.`
      )
    }
  }
  return paths
}

function executable(path: string): boolean {
  try {
    accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * What to tell the user when ffmpeg couldn't convert a video. Shared by OP-18 (attaching videos)
 * and OP-35 (render_video). Windows N and KN editions have no Media Foundation, so h264_mf fails
 * there: ffmpeg starts fine, and only the encode does not (memory: opencat-bundles-ffmpeg-for-video).
 */
export function encodeFailureMessage(platform: NodeJS.Platform, stderr: string): string {
  if (platform === 'win32' && /h264_mf|mfplat|MFT|Media ?Foundation|0x80040154/i.test(stderr)) {
    return (
      "Converting video needs Windows' Media Feature Pack, which this edition of Windows doesn't " +
      'include. Install it from Settings > Apps > Optional features > Add a feature, then try again.'
    )
  }
  const last = stderr.trim().split('\n').pop()?.trim()
  return `This video couldn't be converted for X.${last ? ` ffmpeg said: ${last}` : ''}`
}
