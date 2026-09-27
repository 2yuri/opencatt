import { spawn, type ChildProcess } from 'node:child_process'
import { extname } from 'node:path'
import { MediaError } from './store'
import { encodeFailureMessage, type FfmpegBinaries } from './ffmpeg'

// Videos for X (OP-18): checked with ffprobe when attached, refused over X's length limit,
// copied when X takes them as they are, remuxed or converted when it doesn't.

/** X's limit for everyone, Premium included (boss, OP-18). */
export const MAX_VIDEO_MS = 140_000
const MIN_VIDEO_MS = 500
const MAX_FPS = 60
/** X's largest frame: 1920x1200 landscape, 1200x1900 portrait. */
/** X's largest video frames; render_video (OP-35) checks against them too. */
export const LANDSCAPE_BOX = { width: 1920, height: 1200 }
export const PORTRAIT_BOX = { width: 1200, height: 1900 }
/** X's recommended ceiling; a phone's 1080p60 clip can be well above it (OP-71). */
export const MAX_BITRATE = 25_000_000

export interface VideoInfo {
  durationMs: number
  width: number
  height: number
  fps: number
  videoCodec: string
  pixFmt: string
  audioCodec: string | null
  /** Bits per second for the whole file, when ffprobe knows it. */
  bitRate: number | null
  /** HLG or PQ (an iPhone's default HDR): needs tone mapping to look right on X (OP-71). */
  hdr: boolean
}

interface ProbeJson {
  streams?: {
    codec_type?: string
    codec_name?: string
    width?: number
    height?: number
    pix_fmt?: string
    avg_frame_rate?: string
    r_frame_rate?: string
    tags?: { rotate?: string }
    side_data_list?: { rotation?: number }[]
    color_transfer?: string
  }[]
  format?: { duration?: string; bit_rate?: string }
}

const rate = (value: string | undefined): number => {
  const [num, den] = (value ?? '0/1').split('/').map(Number)
  return den ? num! / den : 0
}

/** The parts of ffprobe's JSON that decide what X will take. */
export function parseProbe(json: ProbeJson): VideoInfo {
  const video = json.streams?.find((s) => s.codec_type === 'video')
  if (!video) throw new MediaError('That file has no video in it.')
  const audio = json.streams?.find((s) => s.codec_type === 'audio')
  // Phone videos are often stored sideways with a rotation flag; X sees the rotated size.
  const rotation = Math.abs(
    Number(
      video.tags?.rotate ??
        video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
        0
    )
  )
  const sideways = rotation === 90 || rotation === 270
  return {
    durationMs: Math.round(Number(json.format?.duration ?? 0) * 1000),
    width: (sideways ? video.height : video.width) ?? 0,
    height: (sideways ? video.width : video.height) ?? 0,
    fps: rate(video.avg_frame_rate) || rate(video.r_frame_rate),
    videoCodec: video.codec_name ?? '',
    pixFmt: video.pix_fmt ?? '',
    audioCodec: audio?.codec_name ?? null,
    bitRate: Number(json.format?.bit_rate) || null,
    // arib-std-b67 is HLG, smpte2084 is PQ (HDR10, Dolby Vision's base layer).
    hdr: video.color_transfer === 'arib-std-b67' || video.color_transfer === 'smpte2084'
  }
}

/** A plain reason X won't take this video at all, or null. */
export function refusal(info: VideoInfo): string | null {
  if (info.durationMs > MAX_VIDEO_MS) {
    return `X takes videos up to 2 minutes 20 seconds, and this one is ${formatLength(info.durationMs)}.`
  }
  if (info.durationMs < MIN_VIDEO_MS) return 'That video is too short for X (under half a second).'
  if (info.width < 32 || info.height < 32) return 'That video is too small for X.'
  return null
}

export type VideoPlan = 'copy' | 'remux' | 'convert'

/** Copy what X takes as it is, rewrap H.264/AAC in MP4, convert anything else. */
export function planFor(info: VideoInfo, path: string): VideoPlan {
  const box = info.height > info.width ? PORTRAIT_BOX : LANDSCAPE_BOX
  const codecsOk =
    info.videoCodec === 'h264' &&
    info.pixFmt === 'yuv420p' &&
    (info.audioCodec === null || info.audioCodec === 'aac') &&
    info.width <= box.width &&
    info.height <= box.height &&
    info.fps <= MAX_FPS + 0.5 &&
    !info.hdr &&
    (info.bitRate === null || info.bitRate <= MAX_BITRATE)
  if (!codecsOk) return 'convert'
  return extname(path).toLowerCase() === '.mp4' ? 'copy' : 'remux'
}

/**
 * The platform's own H.264 encoder in the bundled LGPL ffmpeg (no libx264). Shared with OP-35's
 * render_video.
 */
export function h264Encoder(platform: NodeJS.Platform): string[] {
  return platform === 'darwin'
    ? // Without -allow_sw, Macs with no hardware encoder fail with -12908 (memory: ffmpeg).
      ['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-profile:v', 'high']
    : platform === 'win32'
      ? ['-c:v', 'h264_mf']
      : ['-c:v', 'libopenh264']
}

/** ffmpeg's arguments to write `output` as an MP4 X takes, with progress on stdout. */
export function ffmpegArgs(
  plan: Exclude<VideoPlan, 'copy'>,
  info: VideoInfo,
  input: string,
  output: string,
  platform: NodeJS.Platform
): string[] {
  const base = ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?']
  const tail = ['-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output]
  if (plan === 'remux') return [...base, '-c', 'copy', ...tail]
  const box = info.height > info.width ? PORTRAIT_BOX : LANDSCAPE_BOX
  const encoder = h264Encoder(platform)
  return [
    ...base,
    '-vf',
    [
      // HDR to SDR BT.709 before anything else, or it comes out washed out (OP-71).
      ...(info.hdr ? [HDR_TO_SDR] : []),
      `scale=w='min(${box.width},iw)':h='min(${box.height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`
    ].join(','),
    '-fpsmax',
    String(MAX_FPS),
    ...encoder,
    '-b:v',
    '6M',
    '-pix_fmt',
    'yuv420p',
    // Tagged as what it now is, so players don't guess (OP-71).
    ...(info.hdr
      ? ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709']
      : []),
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-ar',
    '48000',
    '-ac',
    '2',
    ...tail
  ]
}

/**
 * Tone-maps HLG or PQ video to 8-bit BT.709 with zscale (zimg) and tonemap: linear light, the
 * hable curve, then BT.709 transfer, matrix and primaries in TV range.
 */
export const HDR_TO_SDR = [
  'zscale=t=linear:npl=100',
  'format=gbrpf32le',
  'zscale=p=bt709',
  'tonemap=tonemap=hable:desat=0',
  'zscale=t=bt709:m=bt709:r=tv',
  'format=yuv420p'
].join(',')

function formatLength(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} seconds` : `${Math.floor(s / 60)} min ${s % 60} s`
}

export type Spawn = (command: string, args: string[]) => ChildProcess

export interface PreparedVideo {
  /** The file to keep: the original for a copy, or `output` after a remux or conversion. */
  path: string
  info: VideoInfo
  plan: VideoPlan
}

export interface PrepareOptions {
  /** Where a remux or conversion is written. */
  output: string
  signal?: AbortSignal
  /** 0 to 1, while remuxing or converting. */
  onProgress?: (fraction: number) => void
}

/** Checks a video with ffprobe and, when X wouldn't take it, rewrites it with ffmpeg. */
export class VideoPreparer {
  constructor(
    private readonly binaries: () => FfmpegBinaries,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly spawnImpl: Spawn = (command, args) =>
      spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  ) {}

  async probe(path: string): Promise<VideoInfo> {
    const { stdout, code } = await this.run(this.binaries().ffprobe, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      path
    ])
    if (code !== 0) throw new MediaError("That video can't be read. It may be damaged.")
    let json: ProbeJson
    try {
      json = JSON.parse(stdout) as ProbeJson
    } catch {
      throw new MediaError("That video can't be read. It may be damaged.")
    }
    return parseProbe(json)
  }

  async prepare(path: string, options: PrepareOptions): Promise<PreparedVideo> {
    const info = await this.probe(path)
    const refused = refusal(info)
    if (refused) throw new MediaError(refused)
    const plan = planFor(info, path)
    if (plan === 'copy') return { path, info, plan }
    const { code, stderr } = await this.run(
      this.binaries().ffmpeg,
      ffmpegArgs(plan, info, path, options.output, this.platform),
      options.signal,
      (line) => {
        const us = /^out_time_us=(\d+)/.exec(line)
        if (us && info.durationMs > 0) {
          options.onProgress?.(Math.min(1, Number(us[1]) / 1000 / info.durationMs))
        }
      }
    )
    if (options.signal?.aborted) throw new MediaError('Adding the video was cancelled.')
    if (code !== 0) throw new MediaError(encodeFailureMessage(this.platform, stderr))
    options.onProgress?.(1)
    return { path: options.output, info, plan }
  }

  private run(
    command: string,
    args: string[],
    signal?: AbortSignal,
    onLine?: (line: string) => void
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new MediaError('Adding the video was cancelled.'))
      const child = this.spawnImpl(command, args)
      let stdout = ''
      let stderr = ''
      let pending = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        stdout += text
        if (!onLine) return
        pending += text
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) onLine(line.trim())
      })
      // Only the end of stderr matters for the error message.
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-4000)
      })
      const onAbort = (): void => void child.kill('SIGKILL')
      signal?.addEventListener('abort', onAbort, { once: true })
      child.once('error', (err) => {
        signal?.removeEventListener('abort', onAbort)
        reject(new MediaError(`OpenCatt's video tools couldn't start: ${err.message}`))
      })
      child.once('close', (code) => {
        signal?.removeEventListener('abort', onAbort)
        resolve({ code, stdout, stderr })
      })
    })
  }
}
