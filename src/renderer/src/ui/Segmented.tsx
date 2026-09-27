import type { ButtonHTMLAttributes, HTMLAttributes } from 'react'

/**
 * A segmented switch (design v2). The caller keeps the semantics: a role="group" of
 * aria-pressed buttons, or a role="tablist" of tabs that set aria-pressed as well; the chosen
 * item is styled from aria-pressed.
 */
export function Segmented({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return (
    <div
      className={[
        'box-border inline-flex h-[32px] gap-[2px] rounded-[9px] border border-ds-border bg-ds-inset p-[3px]',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  )
}

export function SegmentedItem({
  className,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      type={type}
      className={[
        'cursor-pointer rounded-[6px] border-0 bg-transparent px-[12px] text-[12px] font-medium text-ds-text-2 aria-pressed:bg-ds-raised aria-pressed:text-ds-text',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  )
}
