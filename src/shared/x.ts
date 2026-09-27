// Everything about the user's own X developer app that both main and renderer need.
// See the memory page "x-auth-native-app-pkce-loopback-callback-on-127-0-0-1-47823".

/** Fixed, because X only accepts callbacks registered exactly. X wants 127.0.0.1, not localhost. */
export const X_CALLBACK_PORT = 47823
export const X_CALLBACK_URL = `http://127.0.0.1:${X_CALLBACK_PORT}/callback`

export const XLinks = {
  console: 'https://console.x.com',
  appsGuide: 'https://docs.x.com/fundamentals/developer-apps',
  pricing: 'https://docs.x.com/x-api/getting-started/pricing'
} as const

export type XAuthMode = 'oauth2' | 'oauth1'

/** The four OAuth 1.0a values for acting as your own account: the Consumer Key and Secret X shows once when the app is created, and an Access Token and Secret generated under Keys & Tokens → OAuth 1.0 Keys. */
export interface OAuth1Keys {
  apiKey: string
  apiKeySecret: string
  accessToken: string
  accessTokenSecret: string
}

const CLIENT_ID = /^[A-Za-z0-9_-]{20,64}$/
const KEY = /^[A-Za-z0-9_-]{10,128}$/
// Access tokens start with the numeric id of the account they belong to.
const ACCESS_TOKEN = /^\d+-[A-Za-z0-9_-]{10,128}$/

/** Returns why the client ID can't be right, or null when it looks fine. Expects a trimmed value. */
export function clientIdError(clientId: string): string | null {
  if (clientId === '')
    return "Paste the Client ID from your app's Keys & Tokens tab, under OAuth 2.0 Keys."
  if (/\s/.test(clientId)) return 'The Client ID has no spaces in it. Copy it again.'
  if (clientId.length < 20) return 'That is too short for a Client ID. Copy the whole value.'
  if (!CLIENT_ID.test(clientId)) {
    return 'That does not look like an OAuth 2.0 Client ID. Make sure it is not the Client Secret or an API key.'
  }
  return null
}

export type OAuth1KeysErrors = Partial<Record<keyof OAuth1Keys, string>>

/** Per-field problems with pasted OAuth 1.0a keys; an empty object means they look fine. Expects trimmed values. */
export function oauth1KeysErrors(keys: OAuth1Keys): OAuth1KeysErrors {
  const errors: OAuth1KeysErrors = {}
  const check = (field: keyof OAuth1Keys, label: string, pattern: RegExp, hint: string): void => {
    const value = keys[field]
    if (value === '') errors[field] = `Paste the ${label}.`
    else if (!pattern.test(value)) errors[field] = hint
  }
  check('apiKey', 'Consumer Key', KEY, 'That does not look like a Consumer Key. Copy it again.')
  check('apiKeySecret', 'Consumer Secret', KEY, 'That does not look like a Consumer Secret.')
  check(
    'accessToken',
    'Access Token',
    ACCESS_TOKEN,
    'An Access Token starts with digits and a dash, like 12345-abc… Make sure it is not the Bearer Token.'
  )
  check(
    'accessTokenSecret',
    'Access Token Secret',
    KEY,
    'That does not look like an Access Token Secret.'
  )
  return errors
}

export function trimKeys(keys: OAuth1Keys): OAuth1Keys {
  return {
    apiKey: keys.apiKey.trim(),
    apiKeySecret: keys.apiKeySecret.trim(),
    accessToken: keys.accessToken.trim(),
    accessTokenSecret: keys.accessTokenSecret.trim()
  }
}
