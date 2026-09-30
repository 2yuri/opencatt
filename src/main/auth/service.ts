import type { AuthStatus } from '@shared/api'
import type { Platform } from '@shared/platforms'
import type { OAuth1Keys } from '@shared/x'
import { AuthError } from '@shared/authErrors'
import type { AccountsStore } from '../db/accounts'
import type { PostsService } from '../db/posts'
import type { SettingsStore } from '../db/settings'
import { CredentialName, SettingKey } from '../onboarding'
import { SecureStorageUnavailableError, type CredentialStore } from './credentials'
import { waitForCallback } from './loopback'
import { pkceRequest } from './pkce'
import {
  TokenRejectedError,
  exchangeCode,
  fetchProfile,
  refreshTokens,
  revokeToken,
  type Fetch,
  type OAuth2Tokens,
  type XProfile
} from './xOAuth'

export const ACTIVE_ACCOUNT_KEY = 'x.activeAccountId'

/** Refresh this long before X says the token expires, so a publish never starts on a dying one. */
const REFRESH_EARLY_MS = 60 * 1000

/** One entry per account in the encrypted CredentialStore, under credentialName(id). */
export type StoredCredentials =
  ({ mode: 'oauth2' } & OAuth2Tokens) | ({ mode: 'oauth1' } & OAuth1Keys)

/** What the X client (OP-6) signs a request with. */
export type XCredentials =
  { mode: 'oauth2'; accessToken: string } | { mode: 'oauth1'; keys: OAuth1Keys }

export const credentialName = (accountId: string): string => `x.account.${accountId}`

/** The account needs signing in again; OP-10 marks its posts failed with error_code auth. */
export class ReconnectNeededError extends Error {
  constructor(readonly accountId: string) {
    super('X signed this account out. Reconnect it to keep posting.')
    this.name = 'ReconnectNeededError'
  }
}

export interface XAuthDeps {
  accounts: AccountsStore
  posts: PostsService
  settings: SettingsStore
  credentials: CredentialStore
  openBrowser: (url: string) => Promise<void> | void
  fetch?: Fetch
  now?: () => Date
  /** Tells windows about any change to the accounts. */
  onChanged?: (status: AuthStatus) => void
  /** The user disconnected this account, for settings that shouldn't outlive it (OP-105). */
  onDisconnected?: (accountId: string) => void
  /** Tests point the callback server elsewhere. */
  callbackPort?: number
  callbackTimeoutMs?: number
}

/**
 * Every X account OpenCatt posts as, signed in through the user's one X app: OAuth 2.0 PKCE with
 * the Client ID from onboarding, or the OAuth 1.0a keys pasted there, which make one account.
 */
export class XAuthService {
  private pending: AbortController | null = null
  private portFree: Promise<void> = Promise.resolve()
  private refreshing = new Map<string, Promise<XCredentials>>()
  /**
   * Bumped whenever an account's tokens are replaced by signing in or wiped by signing out, so a
   * refresh that was already waiting on X can tell its answer is stale and must not be saved.
   */
  private generation = new Map<string, number>()
  private readonly fetch: Fetch
  private readonly now: () => Date

  constructor(private readonly deps: XAuthDeps) {
    this.fetch = deps.fetch ?? fetch
    this.now = deps.now ?? (() => new Date())
    deps.posts.useAccounts({
      active: () => this.activeAccountId(),
      canPost: (id) => this.deps.accounts.get(id)?.needsReconnect === false,
      platform: (id) => this.platformOf(id)
    })
  }

  /** The account's platform, or null when there's no such account (OP-118). */
  platformOf(accountId: string): Platform | null {
    return this.deps.accounts.get(accountId)?.platform ?? null
  }

  status(): AuthStatus {
    return {
      accounts: this.deps.accounts.list(),
      activeAccountId: this.activeAccountId(),
      secureStorage: this.deps.credentials.isAvailable()
    }
  }

  private activeAccountId(): string | null {
    const saved = this.deps.settings.get(ACTIVE_ACCOUNT_KEY)
    if (typeof saved === 'string' && this.deps.accounts.get(saved)) return saved
    return this.deps.accounts.list()[0]?.id ?? null
  }

  setActive(accountId: string): AuthStatus {
    if (!this.deps.accounts.get(accountId)) throw new Error(`No X account ${accountId}`)
    this.deps.settings.set(ACTIVE_ACCOUNT_KEY, accountId)
    return this.changed()
  }

  /** Signs in through the browser. A second call cancels the first, since both share one port. */
  async connect(): Promise<{ accountId: string; handle: string }> {
    this.pending?.abort()
    const controller = new AbortController()
    this.pending = controller
    try {
      // The cancelled sign-in's server lets go of the port a moment after it is told to.
      await this.portFree
      const clientId = this.deps.settings.get(SettingKey.clientId)
      if (typeof clientId !== 'string') {
        throw new AuthError(null, 'Add your X app’s Client ID in the setup first.')
      }
      if (!this.deps.credentials.isAvailable()) throw new SecureStorageUnavailableError()

      const request = pkceRequest(clientId)
      const callback = waitForCallback({
        state: request.state,
        signal: controller.signal,
        port: this.deps.callbackPort,
        timeoutMs: this.deps.callbackTimeoutMs
      })
      this.portFree = callback.closed
      await callback.ready
      await this.deps.openBrowser(request.url)
      const code = await callback.code

      const tokens = await exchangeCode(this.fetch, {
        clientId,
        code,
        verifier: request.verifier,
        now: this.now()
      })
      const profile = await fetchProfile(this.fetch, { bearer: tokens.accessToken })
      this.adopt(profile, { mode: 'oauth2', ...tokens })
      return { accountId: profile.id, handle: profile.handle }
    } finally {
      if (this.pending === controller) this.pending = null
    }
  }

  /**
   * Makes the OAuth 1.0a keys from onboarding an account. Asks X whose they are; when X can't be
   * reached the account is still added under the id the access token starts with.
   */
  async adoptOAuth1(): Promise<void> {
    const keys = this.deps.credentials.get<OAuth1Keys>(CredentialName.oauth1)
    if (!keys) return
    const id = keys.accessToken.split('-')[0]!
    const known = this.deps.accounts.get(id)
    let profile: XProfile
    try {
      profile = await fetchProfile(this.fetch, { oauth1: keys })
    } catch (err) {
      if (err instanceof TokenRejectedError) {
        if (known) this.markNeedsReconnect(id)
        return
      }
      if (known) return
      profile = { id, handle: id, name: null, avatarUrl: null }
    }
    this.adopt(profile, { mode: 'oauth1', ...keys })
  }

  private bump(accountId: string): number {
    const next = (this.generation.get(accountId) ?? 0) + 1
    this.generation.set(accountId, next)
    return next
  }

  private adopt(profile: XProfile, credentials: StoredCredentials): void {
    this.bump(profile.id)
    // Tokens first: an account row never exists without them.
    this.deps.credentials.set(credentialName(profile.id), credentials)
    const first = this.deps.accounts.list().length === 0
    this.deps.accounts.save({ ...profile, mode: credentials.mode })
    // Posts written before any account existed post as the first one.
    if (first) this.deps.posts.assignAccount(profile.id)
    if (first || this.deps.settings.get(ACTIVE_ACCOUNT_KEY) === null) {
      this.deps.settings.set(ACTIVE_ACCOUNT_KEY, profile.id)
    }
    this.changed()
  }

  async disconnect(accountId: string): Promise<AuthStatus> {
    // First, before anything waits: a refresh finishing from here on must not bring tokens back.
    this.bump(accountId)
    const stored = this.deps.credentials.get<StoredCredentials>(credentialName(accountId))
    const clientId = this.deps.settings.get(SettingKey.clientId)
    if (stored?.mode === 'oauth2' && typeof clientId === 'string') {
      await revokeToken(this.fetch, {
        clientId,
        token: stored.refreshToken ?? stored.accessToken
      })
    }
    this.deps.credentials.delete(credentialName(accountId))
    if (stored?.mode === 'oauth1') this.deps.credentials.delete(CredentialName.oauth1)
    // The account stays, signed out: its posts keep showing under it and fail as auth until the
    // user signs in again, instead of vanishing from every calendar.
    this.deps.accounts.setNeedsReconnect(accountId, true)
    this.deps.onDisconnected?.(accountId)
    if (this.deps.settings.get(ACTIVE_ACCOUNT_KEY) === accountId) {
      const signedIn = this.deps.accounts.list().find((a) => !a.needsReconnect)
      if (signedIn) this.deps.settings.set(ACTIVE_ACCOUNT_KEY, signedIn.id)
    }
    return this.changed()
  }

  /**
   * What to sign a request to X with for this account, refreshing an OAuth 2.0 token that is
   * about to expire. Concurrent callers share one refresh, since X rotates the refresh token.
   * Throws ReconnectNeededError when X refuses, and AuthError network when it can't be reached.
   */
  credentialsFor(accountId: string): Promise<XCredentials> {
    const stored = this.deps.credentials.get<StoredCredentials>(credentialName(accountId))
    if (!stored) return Promise.reject(new ReconnectNeededError(accountId))
    if (stored.mode === 'oauth1') {
      const { apiKey, apiKeySecret, accessToken, accessTokenSecret } = stored
      return Promise.resolve({
        mode: 'oauth1',
        keys: { apiKey, apiKeySecret, accessToken, accessTokenSecret }
      })
    }
    const fresh = Date.parse(stored.expiresAt) - REFRESH_EARLY_MS > this.now().getTime()
    if (fresh) return Promise.resolve({ mode: 'oauth2', accessToken: stored.accessToken })
    return this.refresh(accountId, stored)
  }

  /** The token X just refused (a 401) is dropped and fetched again once. */
  forceRefresh(accountId: string): Promise<XCredentials> {
    const stored = this.deps.credentials.get<StoredCredentials>(credentialName(accountId))
    if (!stored) return Promise.reject(new ReconnectNeededError(accountId))
    if (stored.mode === 'oauth1') {
      this.markNeedsReconnect(accountId)
      return Promise.reject(new ReconnectNeededError(accountId))
    }
    return this.refresh(accountId, stored)
  }

  private refresh(
    accountId: string,
    stored: { mode: 'oauth2' } & OAuth2Tokens
  ): Promise<XCredentials> {
    const running = this.refreshing.get(accountId)
    if (running) return running
    const clientId = this.deps.settings.get(SettingKey.clientId)
    const generation = this.generation.get(accountId) ?? 0
    const stale = (): boolean => (this.generation.get(accountId) ?? 0) !== generation
    const task = (async (): Promise<XCredentials> => {
      if (!stored.refreshToken || typeof clientId !== 'string') {
        this.markNeedsReconnect(accountId)
        throw new ReconnectNeededError(accountId)
      }
      try {
        const tokens = await refreshTokens(this.fetch, {
          clientId,
          refreshToken: stored.refreshToken,
          now: this.now()
        })
        if (stale()) {
          // The user signed out, or in again, while X was answering: these tokens are stale.
          await revokeToken(this.fetch, {
            clientId,
            token: tokens.refreshToken ?? tokens.accessToken
          })
          return this.afterStaleRefresh(accountId, stored)
        }
        this.deps.credentials.set(credentialName(accountId), {
          mode: 'oauth2',
          ...tokens,
          refreshToken: tokens.refreshToken ?? stored.refreshToken
        })
        return { mode: 'oauth2', accessToken: tokens.accessToken }
      } catch (err) {
        if (err instanceof TokenRejectedError) {
          // A refusal of tokens the user has since replaced says nothing about the new ones.
          if (stale()) return this.afterStaleRefresh(accountId, stored)
          this.markNeedsReconnect(accountId)
          throw new ReconnectNeededError(accountId)
        }
        throw err
      }
    })()
    this.refreshing.set(accountId, task)
    void task.finally(() => this.refreshing.delete(accountId)).catch(() => {})
    return task
  }

  /**
   * What a refresh whose answer came too late hands its callers: the new sign-in's tokens, read
   * straight from the store, or ReconnectNeededError when none replaced the ones it started from
   * (a sign-out, possibly still revoking). It never goes back through credentialsFor, which
   * would return this same refresh while it is still running.
   */
  private afterStaleRefresh(accountId: string, startedFrom: StoredCredentials): XCredentials {
    const current = this.deps.credentials.get<StoredCredentials>(credentialName(accountId))
    if (!current) throw new ReconnectNeededError(accountId)
    if (current.mode === 'oauth1') {
      const { apiKey, apiKeySecret, accessToken, accessTokenSecret } = current
      return { mode: 'oauth1', keys: { apiKey, apiKeySecret, accessToken, accessTokenSecret } }
    }
    const replaced =
      startedFrom.mode !== 'oauth2' || current.refreshToken !== startedFrom.refreshToken
    const fresh = Date.parse(current.expiresAt) - REFRESH_EARLY_MS > this.now().getTime()
    if (!replaced || !fresh) throw new ReconnectNeededError(accountId)
    return { mode: 'oauth2', accessToken: current.accessToken }
  }

  private markNeedsReconnect(accountId: string): void {
    if (this.deps.accounts.get(accountId)?.needsReconnect) return
    this.deps.accounts.setNeedsReconnect(accountId, true)
    this.changed()
  }

  private changed(): AuthStatus {
    const status = this.status()
    this.deps.onChanged?.(status)
    return status
  }
}
