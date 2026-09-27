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
  html: string,
  kinds: readonly MediaKind[]
): Record<string, string> {
  const ids = turnAttachments(source, kinds).filter((id) => !html.includes(`asset://${id}`))
  if (ids.length === 0) return {}
  return {
    attachment_note:
      `The user attached ${ids.join(', ')} and this render doesn't place ` +
      `${ids.length === 1 ? 'it' : 'them'}. If the design shows their file, like their logo or a ` +
      `photo, render again with assets: ${JSON.stringify(ids)} and <img src="asset://${ids[0]}">, ` +
      "the real file, not a drawing of it. If it doesn't need their file, ignore this."
  }
}

/** The running turn's attachments of the kinds a tool can place. */
function turnAttachments(source: AssetSource | undefined, kinds: readonly MediaKind[]): string[] {
  return (source?.attached?.() ?? []).filter((id) => {
    const kind = source?.lookup(id)?.kind
    return kind !== undefined && kinds.includes(kind)
  })
}

/**
 * The files a render may load: the `assets` argument, checked against what the user gave, plus
 * the running turn's attachments always, so a page that names asset://<id> never finds it
 * blocked because the model forgot to list it.
 */
export function assetsInput(
  value: unknown,
  source: AssetSource | undefined,
  kinds: readonly MediaKind[]
): RenderAssets {
  const assets = new Map<string, string>()
  for (const id of turnAttachments(source, kinds)) assets.set(id, source!.lookup(id)!.path)
  if (value === undefined) return assets
  if (!Array.isArray(value)) throw new ToolInputError('assets must be an array of media ids')
  const allowed = source?.allowed() ?? new Set<string>()
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

/** Whether a render session lets a request through: data:, about:blank, and its own assets. */
export function renderRequestAllowed(url: string, assets: RenderAssets): boolean {
  if (url.startsWith('data:') || url === 'about:blank') return true
  const id = assetId(url)
  return id !== null && assets.has(id)
}
