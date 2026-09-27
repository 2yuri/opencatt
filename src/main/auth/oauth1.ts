import { createHmac, randomBytes } from 'node:crypto'
import type { OAuth1Keys } from '@shared/x'

// RFC 3986 percent-encoding, which OAuth 1.0a requires; encodeURIComponent leaves !*'() alone.
const encode = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  )

export interface OAuth1Request {
  method: string
  /** With or without a query string; query parameters are signed too. */
  url: string
  /** Form body parameters, signed as well. A JSON or multipart body is not. */
  form?: Record<string, string>
  nonce?: string
  timestamp?: number
}

/** The Authorization header for a request signed with the user's OAuth 1.0a keys (HMAC-SHA1). */
export function oauth1Header(keys: OAuth1Keys, request: OAuth1Request): string {
  const url = new URL(request.url)
  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: request.nonce ?? randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(request.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: keys.accessToken,
    oauth_version: '1.0'
  }
  const params: [string, string][] = [
    ...Object.entries(oauth),
    ...url.searchParams.entries(),
    ...Object.entries(request.form ?? {})
  ]
  const normalized = params
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const base = [
    request.method.toUpperCase(),
    encode(`${url.origin}${url.pathname}`),
    encode(normalized)
  ].join('&')
  const signingKey = `${encode(keys.apiKeySecret)}&${encode(keys.accessTokenSecret)}`
  oauth['oauth_signature'] = createHmac('sha1', signingKey).update(base).digest('base64')
  return (
    'OAuth ' +
    Object.entries(oauth)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${encode(k)}="${encode(v)}"`)
      .join(', ')
  )
}
