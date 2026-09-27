import type { ReactNode } from 'react'
import { Calendar, Cat, Inbox, Plug, Settings } from 'lucide-react'
import { Link } from 'react-router'
import { usePending } from '../calendar/usePending'
import { NavItem } from '../ui'
import { AccountSwitcher } from './AccountSwitcher'
import { SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH, useSidebarRail } from './layout'
import { useActiveAccount, usePendingByAccount } from './useActiveAccount'

/**
 * The app's left column (design v2): brand, the screens, integrations and settings, and the X
 * account. On a narrow window (OP-58) it is a 64px rail of icons, each with its name as a
 * tooltip. Once an X account is connected, the account row switches between accounts (OP-60).
 */
export function Sidebar({ connected }: { connected: boolean }): React.JSX.Element {
  // The active account's count: posts.pending covers only it.
  const pending = usePending()
  const waiting = pending?.count ?? 0
  const rail = useSidebarRail()
  const account = connected ? 'Your X app is set up' : 'Not set up'
  const { status, active } = useActiveAccount()
  // Main always keeps one active while any is connected; the first stands in until it says which.
  const shown = active ?? status?.accounts[0]
  const byAccount = usePendingByAccount()

  return (
    <nav
      className={`sidebar ${rail ? 'rail' : ''}`}
      style={{ width: rail ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH }}
      aria-label="OpenCatt"
      data-rail={rail || undefined}
    >
      <div className="sidebar-brand" title={rail ? 'OpenCatt' : undefined}>
        <span className="sidebar-logo" aria-hidden="true">
          <Cat size={15} strokeWidth={2} />
        </span>
        {!rail && <span className="sidebar-name">OpenCatt</span>}
      </div>

      <Entry to="/" end label="Calendar" rail={rail} icon={<Calendar size={16} />} />
      <Entry
        to="/approvals"
        label="Approvals"
        rail={rail}
        icon={<Inbox size={16} />}
        badge={waiting}
      />

      <span className="sidebar-spacer" />

      <Entry to="/integrations" label="Integrations" rail={rail} icon={<Plug size={16} />} />
      <Entry to="/settings" label="Settings" rail={rail} icon={<Settings size={16} />} />
      {status && shown ? (
        <AccountSwitcher status={status} active={shown} pending={byAccount} rail={rail} />
      ) : (
        <Link
          to="/setup"
          className="sidebar-account text-inherit no-underline"
          title={rail ? `X account: ${account}` : undefined}
        >
          <span className="sidebar-avatar" aria-hidden="true">
            X
          </span>
          {rail ? (
            <span className="sr-only">X account: {account}</span>
          ) : (
            <span className="sidebar-account-text">
              <span className="sidebar-account-name">X account</span>
              <span className="sidebar-account-state">{account}</span>
            </span>
          )}
        </Link>
      )}
    </nav>
  )
}

function Entry({
  to,
  end,
  label,
  rail,
  icon,
  badge = 0
}: {
  to: string
  end?: boolean
  label: string
  rail: boolean
  icon: ReactNode
  badge?: number
}): React.JSX.Element {
  if (rail) {
    return (
      <NavItem
        to={to}
        end={end}
        title={label}
        aria-label={badge > 0 ? `${label}, ${badge} waiting` : label}
        className="justify-center !px-0"
      >
        <span className="relative grid size-7 place-items-center" aria-hidden="true">
          {icon}
          {/* The count on the icon's corner, like the collapsed agent panel's (OP-58). */}
          {badge > 0 && (
            <span
              className="absolute -top-[4px] left-[19px] grid h-[15px] min-w-[15px] place-items-center rounded-[8px] bg-ds-amber px-[3px] text-[9px] leading-none font-bold text-[#1A1206]"
              data-testid="rail-badge"
            >
              {badge}
            </span>
          )}
        </span>
      </NavItem>
    )
  }
  return (
    <NavItem to={to} end={end}>
      <span className="grid shrink-0 place-items-center" aria-hidden="true">
        {icon}
      </span>
      <span className="nav-label">{label}</span>
      {badge > 0 && (
        <span className="nav-badge" aria-label={`${badge} waiting`}>
          {badge}
        </span>
      )}
    </NavItem>
  )
}
