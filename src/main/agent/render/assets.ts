import { pathToFileURL } from 'node:url'
import { net, type Session } from 'electron'
import type { MediaKind } from '@shared/api'
import { ToolInputError } from '../tools'

/**
 * Files the user attached, placed as they are in a render (OP-89): the page refers to one as
 * asset://<media id>. Must be registered as privileged before app 'ready', like opencat-media.
 */
export const ASSET_SCHEME = 'asset'

/** The files one render may load: media id to its path on disk. Everything else stays blocked. */
export type RenderAssets = ReadonlyMap<string, string>

export const NO_ASSETS: RenderAssets = new Map()

/** What a render tool looks files up in: the user's attachments in this chat, and their paths. */
export interface AssetSource {
  /** Media ids the user attached in the running turn's conversation. */
  allowed(): ReadonlySet<string>
  lookup(id: string): { kind: MediaKind; path: string } | null
  /** Media ids on the user's message the running turn answers. */
  attached?(): readonly string[]
}

/**
 * A note for a render that placed none of the files the user just attached: the model most
 * likely redrew their logo or photo instead of placing it (the bug in OP-89).
 */
export function unplacedAssets(
  source: AssetSource | undefined,
  used: RenderAssets,
  kinds: readonly MediaKind[]
): Record<string, string> {
  const ids = (source?.attached?.() ?? []).filter((id) => {
    const kind = source?.lookup(id)?.kind
    return kind !== undefined && kinds.includes(kind) && !used.has(id)
  })
  if (ids.length === 0) return {}
  return {
    attachment_note:
      `The user attached ${ids.join(', ')} and this render doesn't place ` +
      `${ids.length === 1 ? 'it' : 'them'}. If the design shows their file, like their logo or a ` +
      `photo, render again with assets: ${JSON.stringify(ids)} and <img src="asset://${ids[0]}">, ` +
      "the real file, not a drawing of it. If it doesn't need their file, ignore this."
  }
}

/** The `assets` argument of render_image or render_video, checked against what the user gave. */
export function assetsInput(
  value: unknown,
  source: AssetSource | undefined,
  kinds: readonly MediaKind[]
): RenderAssets {
  if (value === undefined) return NO_ASSETS
  if (!Array.isArray(value)) throw new ToolInputError('assets must be an array of media ids')
  const allowed = source?.allowed() ?? new Set<string>()
  const assets = new Map<string, string>()
  for (const [i, raw] of value.entries()) {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new ToolInputError(`assets[${i}] must be a media id`)
    }
    const id = raw.trim()
    const found = allowed.has(id) ? source?.lookup(id) : null
    if (!found) {
      throw new ToolInputError(
        `assets[${i}]: ${id} isn't a file the user attached in this chat. Use the media ids ` +
          'shown on their messages.'
      )
    }
    if (!kinds.includes(found.kind)) {
      throw new ToolInputError(`assets[${i}]: ${id} is a ${found.kind}; use ${kinds.join(' or ')}.`)
    }
    assets.set(id, found.path)
  }
  return assets
}

/** The id an asset:// URL asks for, or null. */
export function assetId(url: string): string | null {
  const match = /^asset:\/\/([^/?#]+)\/?$/i.exec(url)
  return match ? decodeURIComponent(match[1]!).toLowerCase() : null
}

/**
 * Serves asset://<id> on a render session from the current render's files only. `current` is
 * read per request, since one session serves one render at a time.
 */
export function serveAssets(ses: Session, current: () => RenderAssets): void {
  ses.protocol.handle(ASSET_SCHEME, (request) => {
    const id = assetId(request.url)
    const path = id ? current().get(id) : undefined
    if (!path) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(path).toString(), { headers: request.headers })
  })
}

/** Whether a render session lets a request through: data:, about:blank, and its own assets. */
export function renderRequestAllowed(url: string, assets: RenderAssets): boolean {
  if (url.startsWith('data:') || url === 'about:blank') return true
  const id = assetId(url)
  return id !== null && assets.has(id)
}
