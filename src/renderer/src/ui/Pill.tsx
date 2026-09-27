import type { HTMLAttributes } from 'react'

export type PillTone = 'pending' | 'scheduled' | 'posted' | 'failed' | 'neutral'

const TONE: Record<PillTone, string> = {
  pending: 'bg-ds-amber-2 text-ds-amber',
  scheduled: 'bg-ds-blue-2 text-ds-blue',
  posted: 'bg-ds-green-2 text-ds-green',
  failed: 'bg-ds-red-2 text-ds-red',
  neutral: 'bg-ds-raised text-ds-text-3'
}

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone: PillTone
}

/** A status pill with a dot in its own colour (design v2). */
export function Pill({ tone, className, ...rest }: PillProps): React.JSX.Element {
  return (
    <span
      className={[
        "inline-flex h-[22px] items-center gap-[5px] rounded-[11px] px-[8px] text-[11px] font-medium whitespace-nowrap before:size-[6px] before:rounded-full before:bg-current before:content-['']",
        TONE[tone],
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  )
}
