export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'md' | 'sm'

// Each group sets its own properties only, so no two classes fight over one property: Tailwind
// doesn't promise an order between, say, h-8 and h-7.
const BASE =
  'inline-flex items-center justify-center gap-[6px] box-border border rounded-[8px] py-0 font-medium ' +
  'cursor-pointer whitespace-nowrap disabled:opacity-45 disabled:cursor-default'

const SIZE: Record<ButtonSize, string> = {
  md: 'h-[32px] text-[13px]',
  sm: 'h-[28px] text-[12px]'
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'px-[14px] border-transparent bg-ds-accent text-white ' +
    'hover:not-disabled:bg-[color-mix(in_srgb,var(--ds-accent)_88%,#fff)]',
  secondary:
    'px-[12px] border-ds-border-strong bg-ds-raised text-ds-text ' +
    'hover:not-disabled:bg-[color-mix(in_srgb,var(--ds-raised)_80%,var(--ds-text)_6%)]',
  ghost:
    'px-[10px] border-transparent bg-transparent text-ds-text-2 ' +
    'hover:not-disabled:bg-ds-raised hover:not-disabled:text-ds-text',
  danger: 'px-[12px] border-transparent bg-ds-red-2 text-ds-red'
}

/** The v2 button look, for elements that aren't a <button>, like a link styled as one. */
export function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  className = ''
): string {
  return [BASE, SIZE[size], VARIANT[variant], className].filter(Boolean).join(' ')
}
