import type { AgentProvider, AgentStatus, ClaudeCliStatus } from '@shared/api'
import type { AgentConfig } from './config'

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
    private readonly claude: ClaudeCli = NO_CLI
  ) {}

  /** Who answers the next message: the user's pick, else the CLI when it is installed. */
  provider(): AgentProvider {
    return this.config.provider() ?? (this.claude.found() ? 'cli' : 'api')
  }

  /** Shown under each reply, like "Claude Code · Opus 5". */
  via(): string {
    const model = this.config.status().models.find((m) => m.id === this.config.model())
    const name = (model?.label.split(',')[0] ?? this.config.model()).replace(/^Claude /, '')
    return `${this.provider() === 'cli' ? 'Claude Code' : 'API key'} · ${name}`
  }

  async status(): Promise<AgentStatus> {
    this.cli ??= this.claude.detect()
    const cli = await this.cli
    const base = this.config.status()
    const provider = this.provider()
    return {
      ...base,
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

  async setModel(model: string): Promise<AgentStatus> {
    this.config.setModel(model)
    return this.status()
  }

  async setProvider(provider: AgentProvider): Promise<AgentStatus> {
    this.config.setProvider(provider)
    return this.status()
  }
}
