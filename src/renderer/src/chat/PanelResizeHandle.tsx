import { PANEL_DEFAULT, PANEL_MIN, PANEL_STEP } from './panelLayout'

interface Props {
  width: number
  max: number
  preview: (width: number) => void
  commit: (width: number) => void
}

/**
 * The agent panel's left edge. Drag it, or focus it and use the arrow keys (16px), Home and
 * End (the limits); double-click puts the default width back.
 */
export function PanelResizeHandle({ width, max, preview, commit }: Props): React.JSX.Element {
  const start = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startX = event.clientX
    let latest = width
    const move = (e: PointerEvent): void => {
      // The panel is on the right, so dragging left makes it wider.
      latest = Math.min(max, Math.max(PANEL_MIN, width + startX - e.clientX))
      preview(latest)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      commit(latest)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const next =
      event.key === 'ArrowLeft'
        ? width + PANEL_STEP
        : event.key === 'ArrowRight'
          ? width - PANEL_STEP
          : event.key === 'Home'
            ? PANEL_MIN
            : event.key === 'End'
              ? max
              : null
    if (next === null) return
    event.preventDefault()
    commit(next)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the agent panel"
      aria-valuemin={PANEL_MIN}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      className="chat-resize"
      onPointerDown={start}
      onDoubleClick={() => commit(PANEL_DEFAULT)}
      onKeyDown={onKeyDown}
    />
  )
}
