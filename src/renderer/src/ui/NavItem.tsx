import { NavLink, type NavLinkProps } from 'react-router'

const BASE =
  'box-border flex h-[32px] w-full cursor-pointer items-center gap-[10px] rounded-[8px] border-0 px-[10px] font-medium no-underline ' +
  'hover:bg-[color-mix(in_srgb,var(--ds-raised)_60%,transparent)] hover:text-ds-text'

/** A sidebar entry (design v2): muted until it is the current screen. */
export function NavItem({
  className,
  ...rest
}: Omit<NavLinkProps, 'className'> & { className?: string }): React.JSX.Element {
  return (
    <NavLink
      className={({ isActive }) =>
        [BASE, isActive ? 'bg-ds-raised text-ds-text' : 'bg-transparent text-ds-text-2', className]
          .filter(Boolean)
          .join(' ')
      }
      {...rest}
    />
  )
}
