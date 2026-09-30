import type { ButtonHTMLAttributes } from 'react'

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'role' | 'type' | 'aria-checked'
> {
  checked: boolean
  /** md is 34×20, as in Settings; sm is 28×16, for a thin bar like the agent panel's (OP-104). */
  size?: 'md' | 'sm'
}

/** An on/off switch (design v2): a role="switch" button; the caller names it and handles clicks. */
export function Switch({
  checked,
  size = 'md',
  className,
  ...rest
}: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={[
        'relative shrink-0 cursor-pointer border-0 p-0 transition-colors disabled:cursor-default disabled:opacity-45',
        size === 'sm' ? 'h-4 w-[28px] rounded-[8px]' : 'h-5 w-[34px] rounded-[10px]',
        checked ? 'bg-ds-accent' : 'bg-ds-border-strong',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] rounded-full bg-white transition-[left] ${size === 'sm' ? 'size-3' : 'size-4'} ${checked ? (size === 'sm' ? 'left-[14px]' : 'left-4') : 'left-[2px]'}`}
      />
    </button>
  )
}
