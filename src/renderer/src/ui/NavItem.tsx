import { NavLink, type NavLinkProps } from 'react-router'

const BASE =
  'box-border flex h-[32px] w-full cursor-pointer items-center gap-[10px] rounded-[8px] border-0 px-[10px] font-medium no-underline ' +
  'bg-transparent hover:bg-[color-mix(in_srgb,var(--ds-raised)_60%,transparent)]'

/** A sidebar entry: muted until it is the current screen, then its label and icon turn accent (OP-111). */
export function NavItem({
  className,
  ...rest
}: Omit<NavLinkProps, 'className'> & { className?: string }): React.JSX.Element {
  return (
    <NavLink
      className={({ isActive }) =>
        [BASE, isActive ? 'text-ds-accent-text' : 'text-ds-text-2 hover:text-ds-text', className]
          .filter(Boolean)
          .join(' ')
      }
      {...rest}
    />
  )
}
