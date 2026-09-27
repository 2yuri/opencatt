import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CredentialStore, SecureStorageUnavailableError, type Cipher } from './auth/credentials'
import { openDatabase } from './db/database'
import { SettingsStore } from './db/settings'
import { CredentialName, OnboardingError, OnboardingService, SettingKey } from './onboarding'

const cipher = (available: boolean): Cipher => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(plain).reverse(),
  decrypt: (data) => Buffer.from(data).reverse().toString()
})

const keys = {
  apiKey: 'xvz1evFS4wEEPTGEFPHBog',
  apiKeySecret: 'L8qq9PZyRg6ieKGEKhZolGC0vJWLw8iEJ88DRdyOg',
  accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
  accessTokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE'
}

function setup(available = true) {
  const settings = new SettingsStore(openDatabase(':memory:'))
  const credentials = new CredentialStore(
    join(mkdtempSync(join(tmpdir(), 'opencat-onb-')), 'x-credentials.bin'),
    cipher(available)
  )
  const onboarding = new OnboardingService(
    settings,
    credentials,
    () => new Date('2026-09-26T10:00:00Z')
  )
  return { settings, credentials, onboarding }
}

describe('OnboardingService', () => {
  it('starts incomplete on a fresh install', () => {
    const { onboarding } = setup()
    expect(onboarding.status()).toEqual({
      complete: false,
      authMode: null,
      clientId: null,
      secureStorage: true
    })
  })

  it('completes with a trimmed client ID and stays complete', () => {
    const { onboarding, settings } = setup()
    onboarding.saveClientId('  dGhpc2lzYW5leGFtcGxlOjE6Y2k \n')
    expect(onboarding.status().complete).toBe(false)
    const status = onboarding.complete()
    expect(status).toMatchObject({
      complete: true,
      authMode: 'oauth2',
      clientId: 'dGhpc2lzYW5leGFtcGxlOjE6Y2k'
    })
    expect(settings.get(SettingKey.onboardingDone)).toBe('2026-09-26T10:00:00.000Z')
  })

  it('refuses a malformed client ID and saves nothing', () => {
    const { onboarding, settings } = setup()
    expect(() => onboarding.saveClientId('nope')).toThrow(OnboardingError)
    expect(settings.get(SettingKey.clientId)).toBeNull()
  })

  it('saves OAuth 1.0a keys encrypted, never in settings', () => {
    const { onboarding, settings, credentials } = setup()
    onboarding.saveOAuth1Keys({ ...keys, apiKey: ` ${keys.apiKey} ` })
    expect(onboarding.complete()).toMatchObject({ complete: true, authMode: 'oauth1' })
    expect(credentials.get(CredentialName.oauth1)).toEqual(keys)
    expect(
      JSON.stringify([settings.get(SettingKey.clientId), settings.get(SettingKey.authMode)])
    ).not.toContain(keys.apiKeySecret)
  })

  it('refuses OAuth 1.0a keys without a keyring', () => {
    const { onboarding } = setup(false)
    expect(onboarding.status().secureStorage).toBe(false)
    expect(() => onboarding.saveOAuth1Keys(keys)).toThrow(SecureStorageUnavailableError)
    expect(onboarding.status().authMode).toBeNull()
  })

  it('drops pasted keys when the user switches to a client ID', () => {
    const { onboarding, credentials } = setup()
    onboarding.saveOAuth1Keys(keys)
    onboarding.saveClientId('dGhpc2lzYW5leGFtcGxlOjE6Y2k')
    expect(credentials.has(CredentialName.oauth1)).toBe(false)
    expect(onboarding.status().authMode).toBe('oauth2')
  })

  it('will not finish before an X app is connected', () => {
    const { onboarding } = setup()
    expect(() => onboarding.complete()).toThrow(/Connect an X app/)
  })

  it('asks for pasted keys again when the stored ones can no longer be decrypted', () => {
    const { onboarding, settings, credentials } = setup()
    onboarding.saveOAuth1Keys(keys)
    onboarding.complete()
    const unreadable = new CredentialStore((credentials as unknown as { path: string }).path, {
      ...cipher(true),
      decrypt: () => {
        throw new Error('bad decrypt')
      }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const after = new OnboardingService(settings, unreadable)
    expect(after.status()).toMatchObject({ complete: false, authMode: 'oauth1' })
    warn.mockRestore()
  })
})
