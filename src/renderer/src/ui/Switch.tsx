import type { ButtonHTMLAttributes } from 'react'

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'role' | 'type' | 'aria-checked'
> {
  checked: boolean
}

/** An on/off switch (design v2): a role="switch" button; the caller names it and handles clicks. */
export function Switch({ checked, className, ...rest }: SwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={[
        'relative h-5 w-[34px] shrink-0 cursor-pointer rounded-[10px] border-0 p-0 transition-colors disabled:cursor-default disabled:opacity-45',
        checked ? 'bg-ds-accent' : 'bg-ds-border-strong',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] size-4 rounded-full bg-white transition-[left] ${checked ? 'left-4' : 'left-[2px]'}`}
      />
    </button>
  )
}
