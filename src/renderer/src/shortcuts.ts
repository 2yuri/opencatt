/**
 * Whether a screen-wide shortcut should leave this key alone: modifier chords, typing in a field,
 * and anything inside a dialog, which handles its own keys.
 */
export function ignoreShortcut(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true
  const target = event.target
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable], [role="dialog"]') !== null
  )
}

/** The agent panel's New chat key (OP-95): ⌘N on macOS, Ctrl+N elsewhere, as main.tsx marks it. */
export function newChatShortcut(): string {
  return document.documentElement.dataset['platform'] === 'mac' ? '⌘N' : 'Ctrl+N'
}
