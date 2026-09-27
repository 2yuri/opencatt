export interface FileSource {
  /** What media.import() takes. */
  path: string
  /** The file's own name, for its chip; null for a pasted image with none. */
  name: string | null
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/**
 * The paths to import for dropped or pasted files (OP-89): a file's own path, or, for one with no
 * file behind it like a screenshot or an image copied in a browser, a temporary copy main saves.
 * Files that all have paths come back at once, so their import starts in the same tick.
 */
export function fileSources(files: File[]): FileSource[] | Promise<FileSource[]> {
  const paths = files.map((file) => window.opencat.media.pathForFile(file))
  if (paths.every(Boolean)) return paths.map((path) => ({ path, name: baseName(path) }))
  return Promise.all(
    files.map(async (file) => {
      const path = window.opencat.media.pathForFile(file)
      if (path) return { path, name: baseName(path) }
      const data = new Uint8Array(await file.arrayBuffer())
      return { path: await window.opencat.media.savePasted(data, file.type), name: null }
    })
  )
}

/** The files a paste carries, or none when it's text; the caller then leaves the paste alone. */
export function pastedFiles(event: React.ClipboardEvent): File[] {
  return Array.from(event.clipboardData.files)
}
