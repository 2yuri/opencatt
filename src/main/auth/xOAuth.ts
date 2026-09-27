import { X_CALLBACK_URL, type OAuth1Keys } from '@shared/x'
import { AuthError } from '@shared/authErrors'
import { oauth1Header } from './oauth1'

export const X_API = 'https://api.x.com'

export type Fetch = typeof fetch

export interface OAuth2Tokens {
  accessToken: string
  /** Absent only when X didn't grant offline.access. */
  refreshToken: string | null
  /** UTC ISO. */
  expiresAt: string
  scope: string
}

export interface XProfile {
  id: string
  handle: string
  name: string | null
  avatarUrl: string | null
}

/** X refused the grant or the token: the user must sign in again. */
export class TokenRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TokenRejectedError'
  }
}

/** X answers in well under a second; a sign-in shouldn't hang on a dead connection. */
const REQUEST_TIMEOUT_MS = 15_000

async function call(fetchImpl: Fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch {
    throw new AuthError('network')
  }
}

async function tokenRequest(
  fetchImpl: Fetch,
  body: Record<string, string>,
  now: Date
): Promise<OAuth2Tokens> {
  const res = await call(fetchImpl, `${X_API}/2/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const detail = String(json['error_description'] ?? json['error'] ?? `HTTP ${res.status}`)
    if (/redirect/i.test(detail)) throw new AuthError('callback_mismatch')
    if (res.status >= 500) throw new AuthError('network')
    throw new TokenRejectedError(`X refused the sign-in: ${detail}`)
  }
  return {
    accessToken: String(json['access_token']),
    refreshToken: typeof json['refresh_token'] === 'string' ? json['refresh_token'] : null,
    expiresAt: new Date(now.getTime() + Number(json['expires_in'] ?? 7200) * 1000).toISOString(),
    scope: String(json['scope'] ?? '')
  }
}

export function exchangeCode(
  fetchImpl: Fetch,
  o: { clientId: string; code: string; verifier: string; now: Date }
): Promise<OAuth2Tokens> {
  return tokenRequest(
    fetchImpl,
    {
      grant_type: 'authorization_code',
      code: o.code,
      redirect_uri: X_CALLBACK_URL,
      code_verifier: o.verifier,
      client_id: o.clientId
    },
    o.now
  )
}

export function refreshTokens(
  fetchImpl: Fetch,
  o: { clientId: string; refreshToken: string; now: Date }
): Promise<OAuth2Tokens> {
  return tokenRequest(
    fetchImpl,
    { grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: o.clientId },
    o.now
  )
}

/** Best effort: signing out locally must not depend on X answering. */
export async function revokeToken(
  fetchImpl: Fetch,
  o: { clientId: string; token: string }
): Promise<void> {
  await fetchImpl(`${X_API}/2/oauth2/revoke`, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token: o.token,
      token_type_hint: 'refresh_token',
      client_id: o.clientId
    }).toString()
  }).catch(() => {})
}

const ME_URL = `${X_API}/2/users/me?user.fields=profile_image_url`

/** Who the token or keys belong to. */
export async function fetchProfile(
  fetchImpl: Fetch,
  auth: { bearer: string } | { oauth1: OAuth1Keys }
): Promise<XProfile> {
  const authorization =
    'bearer' in auth
      ? `Bearer ${auth.bearer}`
      : oauth1Header(auth.oauth1, { method: 'GET', url: ME_URL })
  const res = await call(fetchImpl, ME_URL, { headers: { Authorization: authorization } })
  if (res.status === 401 || res.status === 403) {
    throw new TokenRejectedError('X refused the credentials when asked whose they are.')
  }
  if (!res.ok) throw new AuthError('network', `X answered ${res.status} when asked who you are.`)
  const { data } = (await res.json()) as {
    data: { id: string; username: string; name?: string; profile_image_url?: string }
  }
  return {
    id: data.id,
    handle: data.username,
    name: data.name ?? null,
    avatarUrl: data.profile_image_url ?? null
  }
}
