import type { JsonValue, PostAuthor } from '@shared/api'
import type { SettingsStore } from '../db'

const key = (accountId: string): string => `autopilot.${accountId}`

/**
 * Autopilot per X account (OP-103): when on, posts from the in-app agent and from outside agents
 * over MCP are scheduled without waiting for the user's approval. Off by default.
 */
export class AutopilotStore {
  constructor(
    private readonly settings: SettingsStore,
    /** Whether an X account with this id is connected. */
    private readonly known: (accountId: string) => boolean,
    private readonly onChanged: (accountId: string, on: boolean) => void = () => {}
  ) {}

  get(accountId: string): boolean {
    return this.settings.get(key(accountId)) === true
  }

  set(accountId: string, on: boolean): boolean {
    if (!this.known(accountId)) throw new Error("That X account isn't connected.")
    if (typeof on !== 'boolean') throw new Error('Autopilot must be on or off.')
    this.settings.set(key(accountId), on as JsonValue)
    this.onChanged(accountId, on)
    return on
  }

  /**
   * Off when the account is disconnected (OP-105), so signing it in again doesn't bring Autopilot
   * back without the user turning it on. Posts it already scheduled stay scheduled.
   */
  turnOff(accountId: string): void {
    if (!this.get(accountId)) return
    this.settings.set(key(accountId), false)
    this.onChanged(accountId, false)
  }

  /** Whether a post by this author on this account skips approval. The user's never waits. */
  allows(accountId: string | null, by: PostAuthor): boolean {
    return accountId !== null && by !== 'user' && this.get(accountId)
  }
}
