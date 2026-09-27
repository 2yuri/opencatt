import { pathToFileURL } from 'node:url'
import { net, type Session } from 'electron'
import { ASSET_SCHEME, assetId, type RenderAssets } from './assets'

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
