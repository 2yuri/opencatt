import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Zap } from 'lucide-react'
import { Button } from '../ui'

/**
 * Asked before Autopilot goes on for an account (Pencil "OP-104 · 2"); turning it off asks
 * nothing. Escape, the scrim, the close button and Cancel all keep it off.
 */
export function AutopilotConfirm({
  handle,
  onConfirm,
  onCancel
}: {
  handle: string
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const bodyId = useId()

  // The safe choice has the focus, so Enter alone doesn't turn it on.
  useEffect(() => dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), [])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCancel()
    } else if (event.key === 'Tab') {
      trapFocus(event, dialogRef.current)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-8"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex w-[min(440px,calc(100vw-64px))] flex-col overflow-hidden rounded-[14px] border border-ds-border-strong bg-ds-surface font-sans text-ds-text shadow-[0_16px_48px_#00000080] outline-none"
      >
        <header className="flex h-[60px] shrink-0 items-center gap-2.5 border-b border-ds-border px-5">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-lg bg-ds-amber-2 text-ds-amber"
            aria-hidden="true"
          >
            <Zap size={15} />
          </span>
          <h2 id={titleId} className="m-0 min-w-0 flex-1 truncate text-[15px] font-semibold">
            Turn on Autopilot for @{handle}?
          </h2>
          <button
            type="button"
            className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-ds-text-3 hover:text-ds-text"
            aria-label="Close"
            onClick={onCancel}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <p id={bodyId} className="m-0 px-5 py-[18px] text-[13px] leading-[20px] text-ds-text-2">
          Posts Claude or a connected agent writes for @{handle} will be scheduled without asking
          you. You can still edit or delete them before they go out.
        </p>
        <footer className="flex shrink-0 items-center justify-end gap-2.5 border-t border-ds-border bg-ds-raised px-5 py-3.5">
          <Button data-autofocus variant="secondary" className="!bg-ds-surface" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            Turn on
          </Button>
        </footer>
      </div>
    </div>,
    document.body
  )
}

function trapFocus(event: React.KeyboardEvent, dialog: HTMLElement | null): void {
  if (!dialog) return
  const focusable = dialog.querySelectorAll<HTMLElement>('button:not([disabled])')
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
