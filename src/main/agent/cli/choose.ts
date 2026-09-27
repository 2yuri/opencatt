import type { AgentProvider } from '@shared/api'
import type { AgentRunner, AgentTurn } from '../session'

/**
 * Runs each turn on the provider in the settings (OP-29): the claude CLI or the API key.
 * Decided per turn, so a change in settings takes effect on the next message.
 */
export class ProviderRunner implements AgentRunner {
  constructor(
    private readonly cli: AgentRunner,
    private readonly api: AgentRunner,
    private readonly provider: () => AgentProvider
  ) {}

  run(turn: AgentTurn): Promise<void> {
    return (this.provider() === 'cli' ? this.cli : this.api).run(turn)
  }
}
