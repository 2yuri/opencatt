import { rmSync } from 'node:fs'
import type { PostMedia } from '@shared/api'
import { mediaTypeFor } from './files'
import { MediaError, type MediaStore } from './store'
import type { VideoPreparer } from './video'

/**
 * Imports what the user attached: images straight into the media store, videos through ffprobe
 * and, when X needs it, ffmpeg first (OP-18). One import at a time can be cancelled.
 */
export class MediaImports {
  private cancel: AbortController | null = null

  constructor(
    private readonly store: MediaStore,
    private readonly videos: VideoPreparer,
    /** Progress of a video being converted, 0 to 1, for the editor. */
    private readonly onProgress: (path: string, fraction: number) => void = () => {}
  ) {}

  async import(paths: string[]): Promise<PostMedia[]> {
    const controller = new AbortController()
    this.cancel = controller
    const imported: PostMedia[] = []
    try {
      for (const path of paths) {
        if (mediaTypeFor(path)?.kind !== 'video') {
          imported.push(this.store.import(path))
          continue
        }
        const output = this.store.tempPath()
        try {
          const video = await this.videos.prepare(path, {
            output,
            signal: controller.signal,
            onProgress: (fraction) => this.onProgress(path, fraction)
          })
          imported.push(
            this.store.import(video.path, {
              width: video.info.width,
              height: video.info.height,
              durationMs: video.info.durationMs,
              owned: video.path === output
            })
          )
        } finally {
          rmSync(output, { force: true })
        }
      }
      return imported
    } catch (err) {
      // All or nothing: files from this batch that did import are dropped again.
      for (const media of imported) this.store.discard(media.id)
      throw err instanceof MediaError ? err : new MediaError(String(err))
    } finally {
      if (this.cancel === controller) this.cancel = null
    }
  }

  /** Stops the video conversion in progress; its import rejects as cancelled. */
  cancelImport(): void {
    this.cancel?.abort()
  }
}
