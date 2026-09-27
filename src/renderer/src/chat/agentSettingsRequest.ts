// The Settings screen and the agent panel are siblings in the shell, so the screen asks the panel
// to show its settings with a window event rather than threading state through the shell.
const EVENT = 'opencat:open-agent-settings'

/** Opens the agent panel (expanding it when collapsed) on its settings view. */
export function openAgentSettings(): void {
  window.dispatchEvent(new Event(EVENT))
}

/** Calls `listener` whenever something asks for the agent settings; returns the unsubscribe. */
export function onOpenAgentSettings(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
