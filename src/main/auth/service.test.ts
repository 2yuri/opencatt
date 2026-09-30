import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AuthStatus } from '@shared/api'
import { AccountsStore } from '../db/accounts'
import { openDatabase } from '../db/database'
import { PostsService } from '../db/posts'
import { SettingsStore } from '../db/settings'
import { CredentialName, SettingKey } from '../onboarding'
import { CredentialStore, SecureStorageUnavailableError, type Cipher } from './credentials'
import {
  ACTIVE_ACCOUNT_KEY,
  ReconnectNeededError,
  XAuthService,
  credentialName,
  type StoredCredentials
} from './service'
import { AutopilotStore } from '../agent/autopilot'
import { freePort } from './testPort'

const cipher = (available = true): Cipher => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(plain).reverse(),
  decrypt: (data) => Buffer.from(data).reverse().toString()
})

const users: Record<string, { id: string; username: string; name: string }> = {
  'access-alice': { id: '111', username: 'alice', name: 'Alice' },
  'access-alice-2': { id: '111', username: 'alice_new', name: 'Alice' },
  'access-bob': { id: '222', username: 'bob', name: 'Bob' }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** X's token, users/me and revoke endpoints; `codes` maps an authorization code to a token. */
function fakeX(codes: Record<string, string>) {
  const calls: { url: string; body: URLSearchParams | null; auth: string | null }[] = []
  let refreshAnswer: () => Response | Promise<Response> = () =>
    json(200, { access_token: 'access-alice-2', refresh_token: 'refresh-2', expires_in: 7200 })
  let offline = false
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    if (offline) throw new TypeError('fetch failed')
    const url = String(input)
    const body = typeof init?.body === 'string' ? new URLSearchParams(init.body) : null
    const auth = new Headers(init?.headers).get('Authorization')
    calls.push({ url, body, auth })
    if (url.endsWith('/2/oauth2/token')) {
      if (body?.get('grant_type') === 'refresh_token') return refreshAnswer()
      const token = codes[body?.get('code') ?? '']
      if (!token) return json(400, { error: 'invalid_request', error_description: 'bad code' })
      return json(200, {
        access_token: token,
        refresh_token: `refresh-${token}`,
        expires_in: 7200,
        scope: 'tweet.read tweet.write users.read media.write offline.access'
      })
    }
    if (url.includes('/2/users/me')) {
      if (auth?.startsWith('OAuth '))
        return json(200, { data: { id: '370773112', username: 'keys' } })
      const user = users[auth?.replace('Bearer ', '') ?? '']
      return user ? json(200, { data: user }) : json(401, {})
    }
    if (url.endsWith('/2/oauth2/revoke')) return json(200, { revoked: true })
    return json(404, {})
  })
  return {
    fetch: fetchImpl as unknown as typeof fetch,
    calls,
    refreshWith: (answer: () => Response | Promise<Response>) => (refreshAnswer = answer),
    goOffline: () => (offline = true)
  }
}

async function setup(options: { codes?: Record<string, string>; keyring?: boolean } = {}) {
  const db = openDatabase(':memory:')
  let clock = new Date('2026-09-27T10:00:00Z')
  const now = (): Date => clock
  const settings = new SettingsStore(db)
  settings.set(SettingKey.clientId, 'client-id-1234567890abc')
  const credentialsPath = join(mkdtempSync(join(tmpdir(), 'opencat-auth-')), 'x.bin')
  const credentials = new CredentialStore(credentialsPath, cipher(options.keyring ?? true))
  const posts = new PostsService(db, now)
  const accounts = new AccountsStore(db, now)
  const x = fakeX(options.codes ?? { 'code-alice': 'access-alice', 'code-bob': 'access-bob' })
  const port = await freePort()
  // The code the "browser" sends back on its next sign-in; null leaves the user thinking.
  let nextCode: string | null = 'code-alice'
  const browser = vi.fn(async (url: string) => {
    const code = nextCode
    if (code === null) return
    const state = new URL(url).searchParams.get('state')
    void fetch(`http://127.0.0.1:${port}/callback?state=${state}&code=${code}`)
  })
  const changes: AuthStatus[] = []
  const autopilot = new AutopilotStore(settings, (id) => accounts.get(id) !== null)
  posts.useAutopilot((accountId, by) => autopilot.allows(accountId, by))
  const auth = new XAuthService({
    accounts,
    posts,
    settings,
    credentials,
    openBrowser: browser,
    fetch: x.fetch,
    now,
    onChanged: (status) => changes.push(status),
    onDisconnected: (accountId) => autopilot.turnOff(accountId),
    callbackPort: port
  })
  return {
    auth,
    autopilot,
    posts,
    settings,
    credentials,
    credentialsPath,
    x,
    browser,
    changes,
    signInAs: (code: string | null) => (nextCode = code),
    advance: (ms: number) => (clock = new Date(clock.getTime() + ms))
  }
}

describe('XAuthService.connect', () => {
  it('adds each account with its own encrypted tokens, and makes the first one active', async () => {
    const t = await setup()
    const early = t.posts.create({
      text: 'before any account',
      scheduledAt: '2026-09-28T09:00:00Z'
    })

    await expect(t.auth.connect()).resolves.toEqual({ accountId: '111', handle: 'alice' })
    t.signInAs('code-bob')
    await expect(t.auth.connect()).resolves.toEqual({ accountId: '222', handle: 'bob' })

    const status = t.auth.status()
    expect(status.accounts.map((a) => [a.id, a.handle, a.mode])).toEqual([
      ['111', 'alice', 'oauth2'],
      ['222', 'bob', 'oauth2']
    ])
    expect(status.activeAccountId).toBe('111')
    expect(t.credentials.get<StoredCredentials>(credentialName('222'))).toMatchObject({
      mode: 'oauth2',
      accessToken: 'access-bob',
      refreshToken: 'refresh-access-bob'
    })
    expect(readFileSync(t.credentialsPath).toString()).not.toContain('access-bob')
    // Posts from before the first account post as it; new ones go to the active account.
    expect(t.posts.get(early.id)?.accountId).toBe('111')
    t.auth.setActive('222')
    expect(t.posts.create({ text: 'new', scheduledAt: '2026-09-28T10:00:00Z' }).accountId).toBe(
      '222'
    )
    expect(t.changes.at(-1)?.activeAccountId).toBe('222')
  })

  it('sends the PKCE verifier and our callback when trading the code', async () => {
    const t = await setup()
    await t.auth.connect()
    const authorize = new URL(t.browser.mock.calls[0]![0])
    const exchange = t.x.calls.find((c) => c.body?.get('grant_type') === 'authorization_code')!
    expect(exchange.body?.get('redirect_uri')).toBe('http://127.0.0.1:47823/callback')
    expect(exchange.body?.get('client_id')).toBe('client-id-1234567890abc')
    expect(exchange.body?.get('code_verifier')).toBeTruthy()
    expect(authorize.searchParams.get('code_challenge')).toBeTruthy()
  })

  it('refreshes an account that signs in again instead of adding it twice', async () => {
    const t = await setup({ codes: { a: 'access-alice', b: 'access-alice-2' } })
    t.signInAs('a')
    await t.auth.connect()
    t.signInAs('b')
    await t.auth.connect()
    const { accounts } = t.auth.status()
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toMatchObject({ id: '111', handle: 'alice_new', needsReconnect: false })
  })

  it('cancels the pending sign-in when called again', async () => {
    const t = await setup()
    t.signInAs(null)
    const first = t.auth.connect()
    await vi.waitFor(() => expect(t.browser).toHaveBeenCalledTimes(1))
    t.signInAs('code-alice')
    const second = t.auth.connect()
    await expect(first).rejects.toMatchObject({ code: 'cancelled' })
    await expect(second).resolves.toMatchObject({ handle: 'alice' })
  })

  it('refuses without a keyring and writes nothing', async () => {
    const t = await setup({ keyring: false })
    await expect(t.auth.connect()).rejects.toBeInstanceOf(SecureStorageUnavailableError)
    expect(t.browser).not.toHaveBeenCalled()
    expect(t.auth.status()).toMatchObject({ accounts: [], secureStorage: false })
  })

  it('says X is unreachable when the token call fails', async () => {
    const t = await setup()
    t.x.goOffline()
    await expect(t.auth.connect()).rejects.toMatchObject({ code: 'network' })
    expect(t.auth.status().accounts).toEqual([])
  })
})

describe('XAuthService.credentialsFor', () => {
  it('returns a fresh token as is, and refreshes an expiring one once for concurrent callers', async () => {
    const t = await setup()
    await t.auth.connect()
    await expect(t.auth.credentialsFor('111')).resolves.toEqual({
      mode: 'oauth2',
      accessToken: 'access-alice'
    })

    t.advance(2 * 60 * 60 * 1000)
    const [a, b] = await Promise.all([t.auth.credentialsFor('111'), t.auth.credentialsFor('111')])
    expect(a).toEqual({ mode: 'oauth2', accessToken: 'access-alice-2' })
    expect(b).toEqual(a)
    const refreshes = t.x.calls.filter((c) => c.body?.get('grant_type') === 'refresh_token')
    expect(refreshes).toHaveLength(1)
    expect(refreshes[0]!.body?.get('refresh_token')).toBe('refresh-access-alice')
    expect(t.credentials.get<StoredCredentials>(credentialName('111'))).toMatchObject({
      refreshToken: 'refresh-2'
    })
  })

  it('marks the account for reconnecting when X refuses the refresh', async () => {
    const t = await setup()
    await t.auth.connect()
    t.x.refreshWith(() => json(400, { error: 'invalid_request', error_description: 'expired' }))
    t.advance(2 * 60 * 60 * 1000)
    await expect(t.auth.credentialsFor('111')).rejects.toBeInstanceOf(ReconnectNeededError)
    expect(t.auth.status().accounts[0]?.needsReconnect).toBe(true)
    expect(t.changes.at(-1)?.accounts[0]?.needsReconnect).toBe(true)
  })

  it('keeps the account when X is only unreachable', async () => {
    const t = await setup()
    await t.auth.connect()
    t.x.refreshWith(() => json(503, {}))
    t.advance(2 * 60 * 60 * 1000)
    await expect(t.auth.credentialsFor('111')).rejects.toMatchObject({ code: 'network' })
    expect(t.auth.status().accounts[0]?.needsReconnect).toBe(false)
  })
})

describe('XAuthService.disconnect', () => {
  it("turns that account's Autopilot off, and signing in again leaves it off (OP-105)", async () => {
    const t = await setup()
    await t.auth.connect()
    t.signInAs('code-bob')
    await t.auth.connect()
    t.autopilot.set('111', true)
    t.autopilot.set('222', true)
    const auto = t.posts.create(
      { text: 'by autopilot', scheduledAt: '2026-09-28T09:00:00Z', accountId: '111' },
      { by: 'agent' }
    )

    await t.auth.disconnect('111')
    expect(t.autopilot.get('111')).toBe(false)
    expect(t.autopilot.get('222')).toBe(true)
    // What Autopilot already scheduled stays as it was.
    expect(t.posts.get(auto.id)).toMatchObject({ status: 'scheduled', autopilot: true })

    t.signInAs('code-alice')
    await t.auth.connect()
    expect(t.autopilot.get('111')).toBe(false)
  })

  it('revokes on X and forgets the tokens, but keeps the account and its posts', async () => {
    const t = await setup()
    await t.auth.connect()
    t.signInAs('code-bob')
    await t.auth.connect()
    const post = t.posts.create({ text: 'mine', scheduledAt: '2026-09-28T09:00:00Z' })

    const status = await t.auth.disconnect('111')
    expect(t.x.calls.at(-1)?.body?.get('token')).toBe('refresh-access-alice')
    expect(t.credentials.has(credentialName('111'))).toBe(false)
    expect(status.accounts.map((a) => [a.id, a.handle, a.needsReconnect])).toEqual([
      ['111', 'alice', true],
      ['222', 'bob', false]
    ])
    expect(status.activeAccountId).toBe('222')
    expect(t.posts.get(post.id)?.accountId).toBe('111')
    await expect(t.auth.credentialsFor('111')).rejects.toBeInstanceOf(ReconnectNeededError)

    // Signing in again brings it back.
    t.signInAs('code-alice')
    await t.auth.connect()
    expect(t.auth.status().accounts[0]).toMatchObject({ id: '111', needsReconnect: false })
  })
})

describe('XAuthService.adoptOAuth1', () => {
  const keys = {
    apiKey: 'xvz1evFS4wEEPTGEFPHBog',
    apiKeySecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    accessTokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE'
  }

  it('makes the pasted keys an account, signed with OAuth 1.0a', async () => {
    const t = await setup()
    t.credentials.set(CredentialName.oauth1, keys)
    await t.auth.adoptOAuth1()
    expect(t.auth.status()).toMatchObject({
      accounts: [{ id: '370773112', handle: 'keys', mode: 'oauth1' }],
      activeAccountId: '370773112'
    })
    expect(t.x.calls.at(-1)?.auth).toMatch(/^OAuth /)
    await expect(t.auth.credentialsFor('370773112')).resolves.toEqual({ mode: 'oauth1', keys })
    expect(t.settings.get(ACTIVE_ACCOUNT_KEY)).toBe('370773112')
  })

  it('falls back to the id in the access token when X is unreachable', async () => {
    const t = await setup()
    t.credentials.set(CredentialName.oauth1, keys)
    t.x.goOffline()
    await t.auth.adoptOAuth1()
    expect(t.auth.status().accounts).toMatchObject([{ id: '370773112', handle: '370773112' }])
  })
})

describe('XAuthService: a refresh racing a sign-out (OP-66)', () => {
  /** Holds X's answer to the next refresh until release() is called. */
  function holdRefresh(t: Awaited<ReturnType<typeof setup>>) {
    let release!: () => void
    const answered = new Promise<void>((resolve) => (release = resolve))
    t.x.refreshWith(async () => {
      await answered
      return json(200, {
        access_token: 'late-access',
        refresh_token: 'late-refresh',
        expires_in: 7200
      })
    })
    return release
  }

  it('keeps the account signed out and revokes the late tokens', async () => {
    const t = await setup()
    await t.auth.connect()
    t.advance(2 * 60 * 60 * 1000)
    const release = holdRefresh(t)
    const refreshing = t.auth.credentialsFor('111')
    await vi.waitFor(() =>
      expect(t.x.calls.some((c) => c.body?.get('grant_type') === 'refresh_token')).toBe(true)
    )

    await t.auth.disconnect('111')
    release()

    await expect(refreshing).rejects.toBeInstanceOf(ReconnectNeededError)
    await expect(t.auth.credentialsFor('111')).rejects.toBeInstanceOf(ReconnectNeededError)
    expect(t.credentials.has(credentialName('111'))).toBe(false)
    expect(t.auth.status().accounts[0]?.needsReconnect).toBe(true)
    const revoked = t.x.calls.filter((c) => c.url.endsWith('/2/oauth2/revoke'))
    expect(revoked.map((c) => c.body?.get('token'))).toEqual([
      'refresh-access-alice',
      'late-refresh'
    ])
  })

  it('hands out the new sign-in’s tokens when the user signed in again meanwhile', async () => {
    const t = await setup({ codes: { again: 'access-alice-2', first: 'access-alice' } })
    t.signInAs('first')
    await t.auth.connect()
    t.advance(2 * 60 * 60 * 1000)
    const release = holdRefresh(t)
    const refreshing = t.auth.credentialsFor('111')
    await vi.waitFor(() =>
      expect(t.x.calls.some((c) => c.body?.get('grant_type') === 'refresh_token')).toBe(true)
    )

    await t.auth.disconnect('111')
    t.signInAs('again')
    await t.auth.connect()
    release()

    await expect(refreshing).resolves.toEqual({ mode: 'oauth2', accessToken: 'access-alice-2' })
    expect(t.credentials.get<StoredCredentials>(credentialName('111'))).toMatchObject({
      accessToken: 'access-alice-2'
    })
    expect(t.auth.status().accounts[0]?.needsReconnect).toBe(false)
  })

  it('doesn’t mark a fresh sign-in as signed out when X refuses the stale refresh', async () => {
    const t = await setup({ codes: { again: 'access-alice-2', first: 'access-alice' } })
    t.signInAs('first')
    await t.auth.connect()
    t.advance(2 * 60 * 60 * 1000)
    let release!: () => void
    const answered = new Promise<void>((resolve) => (release = resolve))
    t.x.refreshWith(async () => {
      await answered
      return json(400, { error: 'invalid_grant', error_description: 'revoked' })
    })
    const refreshing = t.auth.credentialsFor('111')
    await vi.waitFor(() =>
      expect(t.x.calls.some((c) => c.body?.get('grant_type') === 'refresh_token')).toBe(true)
    )
    t.signInAs('again')
    await t.auth.connect()
    release()

    await expect(refreshing).resolves.toEqual({ mode: 'oauth2', accessToken: 'access-alice-2' })
    expect(t.auth.status().accounts[0]?.needsReconnect).toBe(false)
  })
})

describe('XAuthService: a refresh answering while disconnect is still revoking (QA, OP-66)', () => {
  it('rejects with ReconnectNeededError instead of chaining onto itself', async () => {
    const t = await setup()
    await t.auth.connect()
    t.advance(2 * 60 * 60 * 1000)
    let releaseRefresh!: () => void
    const refreshHeld = new Promise<void>((resolve) => (releaseRefresh = resolve))
    t.x.refreshWith(async () => {
      await refreshHeld
      return json(200, {
        access_token: 'late-access',
        refresh_token: 'late-refresh',
        expires_in: 7200
      })
    })
    // Disconnect's own revoke is slow, so the old tokens are still stored when X answers.
    const fetchMock = t.x.fetch as unknown as ReturnType<typeof vi.fn>
    const answer = fetchMock.getMockImplementation() as (
      input: string | URL | Request,
      init?: RequestInit
    ) => Promise<Response>
    let releaseRevoke!: () => void
    const revokeHeld = new Promise<void>((resolve) => (releaseRevoke = resolve))
    let first = true
    fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/2/oauth2/revoke') && first) {
        first = false
        await revokeHeld
      }
      return answer(input, init)
    })

    const refreshing = t.auth.credentialsFor('111')
    await vi.waitFor(() =>
      expect(t.x.calls.some((c) => c.body?.get('grant_type') === 'refresh_token')).toBe(true)
    )
    const signingOut = t.auth.disconnect('111')
    releaseRefresh()

    await expect(refreshing).rejects.toBeInstanceOf(ReconnectNeededError)
    releaseRevoke()
    await signingOut
    await expect(t.auth.credentialsFor('111')).rejects.toBeInstanceOf(ReconnectNeededError)
    expect(t.x.calls.filter((c) => c.body?.get('token') === 'late-refresh')).toHaveLength(1)
  })
})
