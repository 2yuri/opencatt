import type { AgentModel, AgentProvider, AgentStatus } from '@shared/api'
import type { SettingsStore } from '../db'

/**
 * Where the API key lives: OP-4's encrypted CredentialStore in the app, a map in tests.
 * It must refuse to write when the OS gives no real encryption.
 */
export interface SecretStore {
  isAvailable(): boolean
  get<T>(name: string): T | null
  set(name: string, value: unknown): void
  delete(name: string): void
}

const KEY_NAME = 'anthropic.apiKey'
const MODEL_SETTING = 'agent.model'
const PROVIDER_SETTING = 'agent.provider'
const SEND_IMAGES_SETTING = 'agent.sendImages'
const PROVIDERS: AgentProvider[] = ['cli', 'api']

export const AGENT_MODELS: AgentModel[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5, best results' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5, cheaper' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5, cheapest' }
]
export const DEFAULT_MODEL = 'claude-opus-5'

/** The agent's provider settings. Only main reads the key. */
export class AgentConfig {
  constructor(
    private readonly secrets: SecretStore,
    private readonly settings: SettingsStore
  ) {}

  key(): string | null {
    if (!this.secrets.isAvailable()) return null
    return this.secrets.get<string>(KEY_NAME)
  }

  setKey(key: string): void {
    this.secrets.set(KEY_NAME, key)
  }

  clearKey(): void {
    if (this.secrets.isAvailable()) this.secrets.delete(KEY_NAME)
  }

  model(): string {
    const saved = this.settings.get(MODEL_SETTING)
    return AGENT_MODELS.some((m) => m.id === saved) ? (saved as string) : DEFAULT_MODEL
  }

  setModel(model: string): void {
    if (!AGENT_MODELS.some((m) => m.id === model)) throw new Error(`Unknown model ${model}`)
    this.settings.set(MODEL_SETTING, model)
  }

  /** The provider the user picked, or null before they pick one. */
  provider(): AgentProvider | null {
    const saved = this.settings.get(PROVIDER_SETTING)
    return PROVIDERS.includes(saved as AgentProvider) ? (saved as AgentProvider) : null
  }

  setProvider(provider: AgentProvider): void {
    if (!PROVIDERS.includes(provider)) throw new Error(`Unknown provider ${String(provider)}`)
    this.settings.set(PROVIDER_SETTING, provider)
  }

  /** Whether attached images go to the model as pictures. On unless the user turned it off. */
  sendImages(): boolean {
    return this.settings.get(SEND_IMAGES_SETTING) !== false
  }

  setSendImages(on: boolean): void {
    this.settings.set(SEND_IMAGES_SETTING, on === true)
  }

  status(): Pick<AgentStatus, 'hasKey' | 'canStoreKey' | 'model' | 'models' | 'sendImages'> {
    return {
      hasKey: this.key() !== null,
      canStoreKey: this.secrets.isAvailable(),
      model: this.model(),
      models: AGENT_MODELS,
      sendImages: this.sendImages()
    }
  }
}
