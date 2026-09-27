import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodeFailureMessage } from './ffmpeg'
import { ffmpegArgs, parseProbe, planFor, refusal, VideoPreparer, type VideoInfo } from './video'

const info = (fields: Partial<VideoInfo> = {}): VideoInfo => ({
  durationMs: 30_000,
  width: 1280,
  height: 720,
  fps: 30,
  videoCodec: 'h264',
  pixFmt: 'yuv420p',
  audioCodec: 'aac',
  bitRate: null,
  hdr: false,
  ...fields
})

describe('parseProbe', () => {
  it('reads length, size, frame rate and codecs, turning sideways phone video upright', () => {
    expect(
      parseProbe({
        streams: [
          {
            codec_type: 'video',
            codec_name: 'hevc',
            width: 1920,
            height: 1080,
            pix_fmt: 'yuv420p10le',
            avg_frame_rate: '30000/1001',
            side_data_list: [{ rotation: -90 }]
          },
          { codec_type: 'audio', codec_name: 'aac' }
        ],
        format: { duration: '12.345' }
      })
    ).toEqual({
      durationMs: 12_345,
      width: 1080,
      height: 1920,
      fps: 30000 / 1001,
      videoCodec: 'hevc',
      pixFmt: 'yuv420p10le',
      audioCodec: 'aac',
      bitRate: null,
      hdr: false
    })
  })

  it('reads the bitrate and spots HLG and PQ as HDR', () => {
    const probe = (color_transfer?: string) =>
      parseProbe({
        streams: [
          { codec_type: 'video', codec_name: 'hevc', width: 1920, height: 1080, color_transfer }
        ],
        format: { duration: '3', bit_rate: '31000000' }
      })
    expect(probe('arib-std-b67')).toMatchObject({ hdr: true, bitRate: 31_000_000 })
    expect(probe('smpte2084').hdr).toBe(true)
    expect(probe('bt709').hdr).toBe(false)
    expect(probe().hdr).toBe(false)
  })

  it('refuses a file with no video stream', () => {
    expect(() => parseProbe({ streams: [{ codec_type: 'audio' }] })).toThrow(/no video/)
  })
})

describe('what X takes', () => {
  it('refuses videos over 2 min 20 s, under half a second, or tiny', () => {
    expect(refusal(info({ durationMs: 150_000 }))).toBe(
      'X takes videos up to 2 minutes 20 seconds, and this one is 2 min 30 s.'
    )
    expect(refusal(info({ durationMs: 140_000 }))).toBeNull()
    expect(refusal(info({ durationMs: 300 }))).toMatch(/too short/)
    expect(refusal(info({ width: 20 }))).toMatch(/too small/)
  })

  it('copies a ready MP4, rewraps H.264 in a MOV, converts anything else', () => {
    expect(planFor(info(), '/a/clip.mp4')).toBe('copy')
    expect(planFor(info({ audioCodec: null }), '/a/clip.MP4')).toBe('copy')
    expect(planFor(info(), '/a/clip.mov')).toBe('remux')
    expect(planFor(info({ videoCodec: 'hevc' }), '/a/clip.mp4')).toBe('convert')
    expect(planFor(info({ pixFmt: 'yuv420p10le' }), '/a/clip.mp4')).toBe('convert')
    expect(planFor(info({ audioCodec: 'opus' }), '/a/clip.mp4')).toBe('convert')
    expect(planFor(info({ width: 3840, height: 2160 }), '/a/clip.mp4')).toBe('convert')
    expect(planFor(info({ width: 1080, height: 1920 }), '/a/clip.mp4')).toBe('convert')
    expect(planFor(info({ width: 1080, height: 1350 }), '/a/clip.mp4')).toBe('copy')
    expect(planFor(info({ fps: 120 }), '/a/clip.mp4')).toBe('convert')
    expect(planFor(info({ bitRate: 25_000_000 }), '/a/clip.mp4')).toBe('copy')
    expect(planFor(info({ bitRate: 31_000_000 }), '/a/clip.mp4')).toBe('convert')
    expect(planFor(info({ hdr: true }), '/a/clip.mp4')).toBe('convert')
  })

  it('encodes with each platform’s own H.264 encoder', () => {
    const args = (platform: NodeJS.Platform): string =>
      ffmpegArgs('convert', info({ videoCodec: 'hevc' }), 'in.mov', 'out.mp4', platform).join(' ')
    expect(args('darwin')).toContain('-c:v h264_videotoolbox -allow_sw 1')
    expect(args('win32')).toContain('-c:v h264_mf')
    expect(args('linux')).toContain('-c:v libopenh264')
    expect(args('linux')).toContain('-pix_fmt yuv420p -c:a aac')
    expect(args('linux')).toContain('-movflags +faststart -progress pipe:1')
    expect(ffmpegArgs('remux', info(), 'in.mov', 'out.mp4', 'linux').join(' ')).toContain('-c copy')
    const hdr = ffmpegArgs('convert', info({ hdr: true }), 'in.mov', 'out.mp4', 'darwin').join(' ')
    expect(hdr).toContain(
      '-vf zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,scale='
    )
    expect(hdr).toContain('-colorspace bt709 -color_primaries bt709 -color_trc bt709')
    expect(args('linux')).not.toContain('zscale')
  })

  it('points Windows N users to the Media Feature Pack', () => {
    expect(
      encodeFailureMessage(
        'win32',
        '[h264_mf @ 0x1] could not find any MFT for the given media type'
      )
    ).toMatch(/Media Feature Pack/)
    expect(encodeFailureMessage('linux', 'something\nConversion failed!')).toBe(
      "This video couldn't be converted for X. ffmpeg said: Conversion failed!"
    )
  })
})

// Real runs. The clips are made with a full ffmpeg (Homebrew's: our LGPL build can't encode
// MPEG-4 or x264), and converted by the bundled one when scripts/ffmpeg/fetch.sh has fetched it,
// else by the same full ffmpeg. Skipped where there is no full ffmpeg (CI).
const full = ['/opt/homebrew/bin', '/usr/local/bin'].find((dir) => existsSync(join(dir, 'ffprobe')))
const vendored = join(__dirname, '../../../vendor/ffmpeg', `${process.platform}-${process.arch}`)
const toolDir = existsSync(join(vendored, 'ffprobe')) ? vendored : full

describe.skipIf(!full)(`VideoPreparer with a real ffmpeg (${toolDir})`, () => {
  const maker = join(full ?? '', 'ffmpeg')
  const bins = { ffmpeg: join(toolDir ?? '', 'ffmpeg'), ffprobe: join(toolDir ?? '', 'ffprobe') }
  const dir = mkdtempSync(join(tmpdir(), 'opencat-video-'))
  const make = (name: string, args: string[]): string => {
    const out = join(dir, name)
    execFileSync(maker, ['-v', 'error', '-y', ...args, out])
    return out
  }
  const preparer = new VideoPreparer(() => bins)

  it('converts an MPEG-4 Part 2 .mov into H.264 + AAC MP4, reporting progress', async () => {
    const input = make('old.mov', [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine',
      '-t',
      '2',
      '-c:v',
      'mpeg4',
      '-c:a',
      'pcm_s16le'
    ])
    const progress: number[] = []
    const output = join(dir, 'out.mp4')
    const prepared = await preparer.prepare(input, {
      output,
      onProgress: (f) => progress.push(f)
    })
    expect(prepared.plan).toBe('convert')
    expect(prepared.path).toBe(output)
    const after = await preparer.probe(output)
    expect(after).toMatchObject({ videoCodec: 'h264', pixFmt: 'yuv420p', audioCodec: 'aac' })
    expect(planFor(after, output)).toBe('copy')
    expect(progress.at(-1)).toBe(1)
  }, 60_000)

  it('converts an iPhone-style HEVC .mov, 10-bit and upright, into H.264', async () => {
    const input = make('iphone.mov', [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine',
      '-t',
      '2',
      '-c:v',
      'libx265',
      '-pix_fmt',
      'yuv420p10le',
      '-tag:v',
      'hvc1',
      '-c:a',
      'aac'
    ])
    const before = await preparer.probe(input)
    expect(before).toMatchObject({ videoCodec: 'hevc', pixFmt: 'yuv420p10le' })
    const output = join(dir, 'iphone.mp4')
    await preparer.prepare(input, { output })
    expect(await preparer.probe(output)).toMatchObject({
      videoCodec: 'h264',
      pixFmt: 'yuv420p',
      width: 640,
      height: 360
    })
  }, 60_000)

  const hasZscale = (): boolean => {
    try {
      return execFileSync(bins.ffmpeg, ['-hide_banner', '-filters']).toString().includes('zscale')
    } catch {
      return false
    }
  }

  it.each([
    ['HLG, like an iPhone', 'arib-std-b67'],
    ['PQ (HDR10)', 'smpte2084']
  ])(
    'tone-maps %s to 8-bit BT.709',
    async (_name, transfer) => {
      if (!hasZscale()) return
      const input = make(`hdr-${transfer}.mov`, [
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=640x360:rate=30',
        '-t',
        '1',
        '-c:v',
        'libx265',
        '-pix_fmt',
        'yuv420p10le',
        '-tag:v',
        'hvc1',
        '-color_primaries',
        'bt2020',
        '-color_trc',
        transfer,
        '-colorspace',
        'bt2020nc',
        '-x265-params',
        `colorprim=bt2020:transfer=${transfer}:colormatrix=bt2020nc:log-level=none`
      ])
      expect((await preparer.probe(input)).hdr).toBe(true)
      const output = join(dir, `sdr-${transfer}.mp4`)
      const prepared = await preparer.prepare(input, { output })
      expect(prepared.plan).toBe('convert')
      const color = execFileSync(bins.ffprobe, [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_name,pix_fmt,color_transfer,color_primaries',
        '-of',
        'csv=p=0',
        output
      ])
        .toString()
        .trim()
      expect(color).toBe('h264,yuv420p,bt709,bt709')
      expect(await preparer.probe(output)).toMatchObject({ hdr: false, pixFmt: 'yuv420p' })
    },
    60_000
  )

  it('copies an MP4 X already takes, without running ffmpeg', async () => {
    const input = make('ready.mp4', [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=30',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p'
    ])
    const prepared = await preparer.prepare(input, { output: join(dir, 'unused.mp4') })
    expect(prepared).toMatchObject({ plan: 'copy', path: input })
    expect(existsSync(join(dir, 'unused.mp4'))).toBe(false)
  }, 60_000)

  it('refuses a clip over 2 min 20 s before converting anything', async () => {
    const input = make('long.mp4', [
      '-f',
      'lavfi',
      '-i',
      'color=size=32x32:rate=1',
      '-t',
      '150',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p'
    ])
    await expect(preparer.prepare(input, { output: join(dir, 'x.mp4') })).rejects.toThrow(
      /up to 2 minutes 20 seconds/
    )
  }, 60_000)

  it('stops a conversion when cancelled', async () => {
    const input = make('slow.mov', [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x480:rate=30',
      '-t',
      '20',
      '-c:v',
      'mpeg4'
    ])
    const controller = new AbortController()
    const output = join(dir, 'cancelled.mp4')
    const running = preparer.prepare(input, {
      output,
      signal: controller.signal,
      onProgress: () => controller.abort()
    })
    await expect(running).rejects.toThrow(/cancelled/)
    rmSync(output, { force: true })
  }, 60_000)
})
