import type { AgentModel, AgentProvider, AgentStatus, ClaudeCliStatus } from '@shared/api'
import { LISTED_TTL_MS, type AgentConfig } from './config'
import { pickerModels, type ListedModel } from './models'

/** How long the settings form waits on the API's model list before showing the built-in one. */
const LIST_TIMEOUT_MS = 5000

export interface ClaudeCli {
  /** Cheap: looks for the file, runs nothing. Decides the default provider per turn. */
  found: () => boolean
  /** Runs the CLI for its version and login. */
  detect: () => Promise<ClaudeCliStatus>
}

const NO_CLI: ClaudeCli = {
  found: () => false,
  detect: () =>
    Promise.resolve({
      found: false,
      path: null,
      version: null,
      loggedIn: false,
      plan: null,
      error: null
    })
}

/** The settings form's calls. A key is saved only after the provider accepted it. */
export class AgentSettings {
  private cli: Promise<ClaudeCliStatus> | null = null

  constructor(
    private readonly config: AgentConfig,
    private readonly checkKey: (key: string) => Promise<void>,
    private readonly claude: ClaudeCli = NO_CLI,
    /** GET /v1/models for a key (OP-93); the built-in list is used without it. */
    private readonly listModels: (key: string) => Promise<ListedModel[]> = async () => [],
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Who answers the next message: the user's pick, else the CLI when it is installed. */
  provider(): AgentProvider {
    return this.config.provider() ?? (this.claude.found() ? 'cli' : 'api')
  }

  /** Shown under each reply, like "Claude Code · Opus 5". */
  via(): string {
    const id = this.config.model()
    const model = pickerModels(this.config.listed()?.models ?? null).find((m) => m.id === id)
    const name = model ? model.label.split(',')[0]!.replace(/^Claude /, '') : id
    return `${this.provider() === 'cli' ? 'Claude Code' : 'API key'} · ${name}`
  }

  async status(): Promise<AgentStatus> {
    this.cli ??= this.claude.detect()
    const cli = await this.cli
    const base = this.config.status()
    const provider = this.provider()
    return {
      ...base,
      models: await this.models(provider),
      provider,
      providerChosen: this.config.provider() !== null,
      cli,
      ready: provider === 'cli' ? cli.found && cli.loggedIn : base.hasKey
    }
  }

  /** Runs the CLI check again, after the user installed it or logged in. */
  recheck(): Promise<AgentStatus> {
    this.cli = null
    return this.status()
  }

  async setKey(key: string): Promise<AgentStatus> {
    const trimmed = typeof key === 'string' ? key.trim() : ''
    if (!trimmed) throw new Error('Paste your API key first')
    if (!this.config.status().canStoreKey) {
      throw new Error(
        'Your system has no keyring to keep the key safe. Install and unlock GNOME Keyring or KWallet, then restart OpenCatt.'
      )
    }
    await this.checkKey(trimmed)
    this.config.setKey(trimmed)
    return this.status()
  }

  async clearKey(): Promise<AgentStatus> {
    this.config.clearKey()
    return this.status()
  }

  async setSendImages(on: boolean): Promise<AgentStatus> {
    this.config.setSendImages(on)
    return this.status()
  }

  /**
   * The picker's list: on the API path the key's own models from /v1/models, fetched at most once
   * a day and waited on for 5 seconds; the built-in list otherwise, or when that fails. The saved
   * model is always in it, even one typed under Other….
   */
  private async models(provider: AgentProvider): Promise<AgentModel[]> {
    let listed = provider === 'api' ? this.config.listed() : null
    const key = this.config.key()
    if (provider === 'api' && key && (!listed || this.now() - listed.fetchedAt > LISTED_TTL_MS)) {
      let timer: NodeJS.Timeout | undefined
      try {
        const models = await Promise.race([
          this.listModels(key),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('timed out')), LIST_TIMEOUT_MS)
          })
        ])
        if (models.length > 0) {
          this.config.setListed(models, this.now())
          listed = this.config.listed()
        }
      } catch {
        // Offline, or the API refused: the last list, else the built-in one.
      } finally {
        clearTimeout(timer)
      }
    }
    const list = pickerModels(listed?.models ?? null)
    const current = this.config.model()
    return list.some((m) => m.id === current)
      ? list
      : [...list, { id: current, label: `${current} (typed in)` }]
  }

  async setModel(model: string): Promise<AgentStatus> {
    this.config.setModel(model)
    return this.status()
  }

  async setProvider(provider: AgentProvider): Promise<AgentStatus> {
    this.config.setProvider(provider)
    return this.status()
  }
}
