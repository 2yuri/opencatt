import { createHash, randomBytes } from 'node:crypto'
import { X_CALLBACK_URL } from '@shared/x'

/** What OpenCatt asks X for: post and read as the user, upload media, and stay signed in. */
export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access']

export const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize'

export interface PkceRequest {
  url: string
  state: string
  verifier: string
}

/** RFC 7636: a random verifier, and its S256 challenge in the authorize URL. */
export function pkceRequest(clientId: string, random = randomBytes): PkceRequest {
  const verifier = random(32).toString('base64url')
  const state = random(16).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: X_CALLBACK_URL,
    scope: X_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  })
  return { url: `${X_AUTHORIZE_URL}?${params}`, state, verifier }
}
