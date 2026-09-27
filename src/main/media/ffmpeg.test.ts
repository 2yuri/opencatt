import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FfmpegMissingError, ffmpegPaths, requireFfmpeg } from './ffmpeg'

const packed = { packaged: true, resourcesPath: '/r', appPath: '/r/app.asar' }
const dev = { packaged: false, resourcesPath: '/r', appPath: '/proj' }

describe('ffmpeg paths', () => {
  it('uses resources/ffmpeg when packaged, with .exe on Windows only', () => {
    expect(ffmpegPaths({ ...packed, platform: 'win32', arch: 'x64' })).toEqual({
      ffmpeg: join('/r', 'ffmpeg', 'ffmpeg.exe'),
      ffprobe: join('/r', 'ffmpeg', 'ffprobe.exe')
    })
    expect(ffmpegPaths({ ...packed, platform: 'darwin', arch: 'arm64' }).ffmpeg).toBe(
      join('/r', 'ffmpeg', 'ffmpeg')
    )
  })

  it('uses vendor/ffmpeg/<platform>-<arch> in dev', () => {
    expect(ffmpegPaths({ ...dev, platform: 'linux', arch: 'x64' }).ffprobe).toBe(
      join('/proj', 'vendor', 'ffmpeg', 'linux-x64', 'ffprobe')
    )
  })

  it('explains a missing binary, differently for users and developers', () => {
    const none = (): boolean => false
    expect(() => requireFfmpeg({ ...packed, platform: 'darwin', arch: 'arm64' }, none)).toThrow(
      /Reinstall OpenCatt/
    )
    expect(() => requireFfmpeg({ ...dev, platform: 'darwin', arch: 'arm64' }, none)).toThrow(
      FfmpegMissingError
    )
    expect(() => requireFfmpeg({ ...dev, platform: 'darwin', arch: 'arm64' }, none)).toThrow(
      /scripts\/ffmpeg\/fetch\.sh/
    )
    expect(requireFfmpeg({ ...dev, platform: 'linux', arch: 'x64' }, () => true).ffmpeg).toBe(
      join('/proj', 'vendor', 'ffmpeg', 'linux-x64', 'ffmpeg')
    )
  })
})
