import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { MEDIA_PROTOCOL } from './files'
import { ASSET_SCHEME } from '../agent/render/assets'
import type { MediaStore } from './store'

/** Must run before app 'ready'. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_PROTOCOL, privileges: { standard: true, secure: true, stream: true } },
    // The user's files placed in an agent render, served on the render sessions only (OP-89).
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, stream: true } }
  ])
}

/**
 * Serves opencat-media://media/<uuid>.<ext> from the media folder and nothing else, so the
 * renderer can show attached images and videos without file:// access.
 */
export function handleMediaProtocol(media: MediaStore): void {
  protocol.handle(MEDIA_PROTOCOL, (request) => {
    const url = new URL(request.url)
    const file = url.pathname.replace(/^\//, '')
    const path = url.host === 'media' ? media.resolve(file) : null
    if (!path) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(path).toString(), { headers: request.headers })
  })
}
