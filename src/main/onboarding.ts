import type { OnboardingStatus } from '@shared/api'
import {
  clientIdError,
  oauth1KeysErrors,
  trimKeys,
  type OAuth1Keys,
  type XAuthMode
} from '@shared/x'
import type { CredentialStore } from './auth/credentials'
import type { SettingsStore } from './db'

export const SettingKey = {
  clientId: 'x.clientId',
  authMode: 'x.authMode',
  onboardingDone: 'onboarding.completedAt'
} as const

export const CredentialName = { oauth1: 'oauth1' } as const

export class OnboardingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OnboardingError'
  }
}

/**
 * First-run state: which way the user connects to X and whether they finished the wizard.
 * The client ID is not a secret and lives in settings; OAuth 1.0a keys go to the encrypted store.
 * The renderer checks the same rules first, these checks are the ones that count.
 */
export class OnboardingService {
  constructor(
    private readonly settings: SettingsStore,
    private readonly credentials: CredentialStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  status(): OnboardingStatus {
    const authMode = this.settings.get(SettingKey.authMode) as XAuthMode | null
    const clientId = this.settings.get(SettingKey.clientId) as string | null
    const hasCredentials =
      authMode === 'oauth2'
        ? clientId !== null
        : authMode === 'oauth1'
          ? this.credentials.has(CredentialName.oauth1)
          : false
    return {
      complete: hasCredentials && this.settings.get(SettingKey.onboardingDone) !== null,
      authMode,
      clientId,
      secureStorage: this.credentials.isAvailable()
    }
  }

  saveClientId(raw: string): OnboardingStatus {
    const clientId = String(raw ?? '').trim()
    const error = clientIdError(clientId)
    if (error) throw new OnboardingError(error)
    this.settings.set(SettingKey.clientId, clientId)
    this.settings.set(SettingKey.authMode, 'oauth2')
    // Switching away from pasted keys: don't leave the old secrets lying around.
    this.credentials.delete(CredentialName.oauth1)
    return this.status()
  }

  saveOAuth1Keys(raw: OAuth1Keys): OnboardingStatus {
    const keys = trimKeys({
      apiKey: String(raw?.apiKey ?? ''),
      apiKeySecret: String(raw?.apiKeySecret ?? ''),
      accessToken: String(raw?.accessToken ?? ''),
      accessTokenSecret: String(raw?.accessTokenSecret ?? '')
    })
    const errors = Object.values(oauth1KeysErrors(keys))
    if (errors.length > 0) throw new OnboardingError(errors[0]!)
    // Throws SecureStorageUnavailableError on Linux without a keyring, before anything is saved.
    this.credentials.set(CredentialName.oauth1, keys)
    this.settings.set(SettingKey.authMode, 'oauth1')
    return this.status()
  }

  complete(): OnboardingStatus {
    const status = this.status()
    if (status.authMode === null) throw new OnboardingError('Connect an X app before finishing.')
    this.settings.set(SettingKey.onboardingDone, this.now().toISOString())
    return this.status()
  }
}
