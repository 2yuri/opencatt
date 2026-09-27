import type { ComposerMode } from '@shared/api'
import { MODE_COPY, MODE_ICON } from './modes'

interface Props {
  mode: ComposerMode
  onMode: (mode: ComposerMode) => void
  /** Why videos can't be made here, or null when they can. */
  videoUnavailable: string | null
  disabled?: boolean
}

/** Pencil "OP-79 · Composer modes": what the message asks the agent to make. */
export function ModeRow({
  mode,
  onMode,
  videoUnavailable,
  disabled = false
}: Props): React.JSX.Element {
  return (
    <div className="mb-[8px] flex flex-wrap gap-[6px]" role="radiogroup" aria-label="What to make">
      {(['text', 'image', 'video'] as const).map((m) => {
        const Icon = MODE_ICON[m]
        const off = disabled || (m === 'video' && videoUnavailable !== null)
        const picked = mode === m
        const button = (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={picked}
            aria-describedby={m === 'video' && videoUnavailable ? 'video-unavailable' : undefined}
            disabled={off}
            onClick={() => onMode(m)}
            className={`inline-flex h-[28px] cursor-pointer items-center gap-[6px] rounded-[14px] border px-[10px] text-[12px] font-medium disabled:cursor-default disabled:opacity-45 ${
              picked
                ? 'border-ds-accent bg-ds-accent-2 text-ds-accent-text'
                : 'border-ds-border-strong bg-transparent text-ds-text-2 hover:not-disabled:text-ds-text'
            }`}
          >
            <Icon size={13} aria-hidden="true" />
            {MODE_COPY[m].label}
          </button>
        )
        if (m !== 'video' || !videoUnavailable) return button
        // A disabled button gets no hover events, so the wrapper carries the tooltip.
        return (
          <span key={m} className="group relative inline-flex">
            {button}
            <span
              id="video-unavailable"
              role="tooltip"
              className="pointer-events-none absolute bottom-[calc(100%+6px)] left-0 z-20 hidden w-[240px] rounded-[8px] border border-ds-border-strong bg-ds-raised px-[10px] py-[8px] text-[12px] leading-[1.4] text-ds-text group-hover:block"
            >
              {videoUnavailable}
            </span>
          </span>
        )
      })}
    </div>
  )
}

/** The small chip on a sent message that asked for an image or a video. */
export function ModeChip({ mode }: { mode: ComposerMode }): React.JSX.Element | null {
  const chip = MODE_COPY[mode].chip
  if (!chip) return null
  const Icon = MODE_ICON[mode]
  return (
    <span className="inline-flex h-[20px] items-center gap-[4px] self-start rounded-[10px] bg-[#FFFFFF26] px-[8px] text-[11px] font-semibold text-white">
      <Icon size={11} aria-hidden="true" />
      {chip}
    </span>
  )
}
