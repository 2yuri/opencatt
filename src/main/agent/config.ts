import type { AgentProvider, AgentStatus, JsonValue } from '@shared/api'
import type { SettingsStore } from '../db'
import {
  DEFAULT_MODEL,
  PREVIOUS_DEFAULT,
  isModelId,
  pickerModels,
  shapeOf,
  type ListedModel,
  type ModelShape
} from './models'

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
const LISTED_SETTING = 'agent.listedModels'
const ONBOARDED_SETTING = 'onboarding.completedAt'
const PROVIDERS: AgentProvider[] = ['cli', 'api']
/** How long the API's model list is trusted before it is fetched again. */
export const LISTED_TTL_MS = 24 * 60 * 60 * 1000

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
    // Another key may reach other models.
    this.setListed(null)
  }

  clearKey(): void {
    if (this.secrets.isAvailable()) this.secrets.delete(KEY_NAME)
    this.setListed(null)
  }

  model(): string {
    const saved = this.settings.get(MODEL_SETTING)
    return isModelId(saved) ? saved : DEFAULT_MODEL
  }

  /** Any model id: one from the list, or one typed under Other… for the CLI. */
  setModel(model: string): void {
    const id = typeof model === 'string' ? model.trim() : ''
    if (!isModelId(id))
      throw new Error(`"${String(model)}" isn't a model id, like claude-opus-5-5.`)
    this.settings.set(MODEL_SETTING, id)
  }

  /**
   * Once, at startup (OP-93): an install from before the default moved to Opus 5.5 that never
   * picked a model keeps Opus 5, the default it was using. New installs get the new default.
   */
  keepPreviousDefault(): void {
    if (this.settings.get(MODEL_SETTING) !== null) return
    const existing =
      this.settings.get(PROVIDER_SETTING) !== null ||
      this.settings.get(ONBOARDED_SETTING) !== null ||
      this.key() !== null
    if (existing) this.settings.set(MODEL_SETTING, PREVIOUS_DEFAULT)
  }

  /** What the API listed for the saved key, when it was fetched; null before the first fetch. */
  listed(): { fetchedAt: number; models: ListedModel[] } | null {
    const saved = this.settings.get(LISTED_SETTING) as {
      fetchedAt?: unknown
      models?: unknown
    } | null
    if (!saved || typeof saved.fetchedAt !== 'number' || !Array.isArray(saved.models)) return null
    const models = saved.models.filter(
      (m): m is ListedModel =>
        typeof m === 'object' && m !== null && isModelId((m as ListedModel).id)
    )
    return { fetchedAt: saved.fetchedAt, models }
  }

  setListed(models: ListedModel[] | null, fetchedAt: number = Date.now()): void {
    this.settings.set(
      LISTED_SETTING,
      models ? ({ fetchedAt, models } as unknown as JsonValue) : null
    )
  }

  /** What a request to this model sends: adaptive thinking, fallbacks. */
  shape(model: string = this.model()): ModelShape {
    return shapeOf(model, this.listed()?.models)
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
      models: pickerModels(null),
      sendImages: this.sendImages()
    }
  }
}
