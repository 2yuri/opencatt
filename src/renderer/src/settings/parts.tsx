import { ChevronDown } from 'lucide-react'
import type { SelectHTMLAttributes } from 'react'
import { ROW_SUB, ROW_TITLE } from './common'

export function Row({
  title,
  titleId,
  titleFor,
  sub,
  subId,
  error,
  control
}: {
  title: string
  titleId?: string
  /** The control's id, when the title should be its <label>. */
  titleFor?: string
  sub?: string
  subId?: string
  error?: string | null
  control: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        {titleFor ? (
          <label id={titleId} htmlFor={titleFor} className={ROW_TITLE}>
            {title}
          </label>
        ) : (
          <span id={titleId} className={ROW_TITLE}>
            {title}
          </span>
        )}
        {sub && (
          <span id={subId} className={ROW_SUB}>
            {sub}
          </span>
        )}
        {error && (
          <span role="alert" className="text-[12px] leading-[1.45] text-ds-red">
            {error}
          </span>
        )}
      </div>
      {control}
    </div>
  )
}

/** The page's select: an inset box with a chevron. */
export function Select({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <span className="relative shrink-0">
      <select
        className={[
          'h-8 cursor-pointer appearance-none rounded-lg border border-ds-border-strong bg-ds-inset pr-8 pl-3 font-sans text-[12px] font-medium text-ds-text',
          className
        ]
          .filter(Boolean)
          .join(' ')}
        {...rest}
      />
      <ChevronDown
        size={14}
        className="pointer-events-none absolute top-[9px] right-2.5 text-ds-text-3"
        aria-hidden="true"
      />
    </span>
  )
}
