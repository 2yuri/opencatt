import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RenderError } from './tool'

/**
 * GSAP isn't shipped with OpenCatt (boss's call on OP-81): the main process downloads this one
 * pinned file the first time a HyperFrames video is recorded, checks it and keeps it. The recording
 * page itself never touches the network.
 */
export const GSAP_URL = 'https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js'
export const GSAP_SHA384 = 'XmJ9SoHtVOHoQUcKvFAzVXwdkKo1Ie3bhmSoIAkcdsHGaIrVJIkmozyq0FJeb/Ly'
const FILE = 'gsap-3.15.0.min.js'

const sha384 = (bytes: Buffer): string => createHash('sha384').update(bytes).digest('base64')

/** GSAP's source, from the cache in `dir` or downloaded once. */
export function gsapLoader(
  dir: string,
  download: (url: string) => Promise<Buffer>,
  expected: string = GSAP_SHA384
): () => Promise<string> {
  let pending: Promise<string> | null = null
  const load = async (): Promise<string> => {
    const path = join(dir, FILE)
    try {
      const cached = readFileSync(path)
      if (sha384(cached) === expected) return cached.toString('utf8')
    } catch {
      // Not downloaded yet.
    }
    let bytes: Buffer
    try {
      bytes = await download(GSAP_URL)
    } catch {
      throw new RenderError(
        'The first video needs an internet connection, to download the GSAP animation library ' +
          'once. Try again when the computer is online.'
      )
    }
    if (sha384(bytes) !== expected) {
      throw new RenderError(
        "The GSAP animation library downloaded for videos didn't match the expected file, so it " +
          'was not used. Try again later.'
      )
    }
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${path}.part`, bytes)
    renameSync(`${path}.part`, path)
    return bytes.toString('utf8')
  }
  return () => {
    // One download at a time; a failure is retried on the next recording.
    pending ??= load().catch((err: unknown) => {
      pending = null
      throw err
    })
    return pending
  }
}
