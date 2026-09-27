import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Timer } from 'lucide-react'

const VIDEO_LENGTHS = [5, 10, 15, 30, 60] as const

interface Props {
  seconds: number
  onChange: (seconds: number) => void
  disabled?: boolean
}

/**
 * Pencil "OP-79 · Mode states", Generate video + length (OP-81): how long the video is, in the
 * composer bar. A length written in the message wins over this one.
 */
export function LengthPicker({ seconds, onChange, disabled = false }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="inline-flex h-[24px] cursor-pointer items-center gap-[4px] rounded-[12px] border border-ds-border-strong bg-ds-inset pr-[7px] pl-[8px] disabled:cursor-default disabled:opacity-45"
        aria-label={`Video length, ${seconds} seconds`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <Timer size={12} className="text-ds-text-3" aria-hidden="true" />
        <span className="font-mono text-[11px] text-ds-text">{seconds} s</span>
        <ChevronDown size={12} className="text-ds-text-3" aria-hidden="true" />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Video length"
          className="absolute bottom-[calc(100%+6px)] left-0 z-20 m-0 w-[140px] list-none rounded-[10px] border border-ds-border-strong bg-ds-surface p-[4px]"
        >
          {VIDEO_LENGTHS.map((s) => (
            <li key={s} role="option" aria-selected={s === seconds}>
              <button
                type="button"
                className={`flex h-[28px] w-full cursor-pointer items-center gap-[6px] rounded-[6px] border-0 px-[8px] text-left text-[12px] font-medium ${
                  s === seconds
                    ? 'bg-ds-raised text-ds-text'
                    : 'bg-transparent text-ds-text-2 hover:bg-ds-raised'
                }`}
                onClick={() => {
                  onChange(s)
                  setOpen(false)
                }}
              >
                {s} seconds
                {s === seconds && (
                  <Check size={12} className="text-ds-accent-text" aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
