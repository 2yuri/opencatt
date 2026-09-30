import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import type { AuthStatus, XAccount } from '@shared/api'
import { authErrorMessage } from '@shared/authErrors'
import { AutopilotBadge } from '../autopilot/AutopilotBadge'
import { useAutopilot } from '../autopilot/useAutopilot'

// One gradient per account, by its place in the list of accounts, so it keeps its colour everywhere.
const GRADIENTS = [
  'linear-gradient(135deg, #60a5fa, #2563eb)',
  'linear-gradient(135deg, #f472b6, #db2777)',
  'linear-gradient(135deg, #34d399, #059669)',
  'linear-gradient(135deg, #fbbf24, #d97706)',
  'linear-gradient(135deg, #a78bfa, #7c3aed)'
]

function gradientFor(index: number): string {
  return GRADIENTS[Math.max(index, 0) % GRADIENTS.length]!
}

/** What to call an account: its name, or its handle while X hasn't said the name. */
function accountName(account: XAccount): string {
  return account.name || `@${account.handle}`
}

/** The account's X picture, or its first letter on a gradient; `index` is its place in the list. */
export function Avatar({
  account,
  index,
  size
}: {
  account: XAccount
  index: number
  size: number
}): React.JSX.Element {
  const style = { width: size, height: size }
  if (account.avatarUrl) {
    return (
      <img
        className="shrink-0 rounded-full object-cover"
        style={style}
        src={account.avatarUrl}
        alt=""
        aria-hidden="true"
      />
    )
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ ...style, background: gradientFor(index), fontSize: size >= 26 ? 12 : 10 }}
      aria-hidden="true"
    >
      {(account.name || account.handle).charAt(0).toUpperCase()}
    </span>
  )
}

/** A waiting-posts count in amber, as on the Approvals entry. */
function CountPill({ count, label }: { count: number; label: string }): React.JSX.Element {
  return (
    <span
      className="inline-flex h-[18px] shrink-0 items-center rounded-[9px] bg-ds-amber-2 px-[6px] text-[11px] leading-none font-semibold text-ds-amber"
      aria-label={label}
    >
      {count}
    </span>
  )
}

/**
 * The account row at the foot of the sidebar (OP-60): the active X account, how many posts wait
 * in the others, and a menu above it to switch, reconnect or add an account. On the icon rail
 * it is the avatar alone, with the count on its corner.
 */
export function AccountSwitcher({
  status,
  active,
  pending,
  rail
}: {
  status: AuthStatus
  active: XAccount
  pending: Record<string, number>
  rail: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const autopilot = useAutopilot(active.id)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const elsewhere = status.accounts
    .filter((a) => a.id !== active.id)
    .reduce((sum, a) => sum + (pending[a.id] ?? 0), 0)
  const elsewhereLabel = `${elsewhere} waiting in other accounts`

  // An outside click closes the menu.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function close(): void {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={wrapRef} className="relative mt-[6px]">
      {open && (
        <AccountMenu status={status} activeId={active.id} pending={pending} onClose={close} />
      )}
      <button
        ref={triggerRef}
        type="button"
        className={`flex w-full cursor-pointer items-center gap-[10px] rounded-[8px] border-0 bg-ds-raised p-[8px] text-left font-sans ${rail ? 'justify-center' : ''}`}
        aria-label={`Account switcher, ${accountName(active)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={rail ? `@${active.handle}` : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="relative shrink-0">
          <Avatar account={active} index={status.accounts.indexOf(active)} size={26} />
          {rail && elsewhere > 0 && (
            <span
              className="absolute -top-[5px] left-[17px] grid h-[15px] min-w-[15px] place-items-center rounded-[8px] bg-ds-amber px-[3px] text-[9px] leading-none font-bold text-[#1A1206]"
              aria-label={elsewhereLabel}
              data-testid="rail-account-badge"
            >
              {elsewhere}
            </span>
          )}
        </span>
        {!rail && (
          <>
            <span className="flex min-w-0 flex-1 flex-col [&>*]:truncate">
              {/* Autopilot's badge by the name, when it is on (OP-104). */}
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 truncate text-[12px] font-medium text-ds-text">
                  {accountName(active)}
                </span>
                {autopilot.on && <AutopilotBadge />}
              </span>
              <span className="text-[11px] text-ds-text-3">@{active.handle}</span>
            </span>
            {elsewhere > 0 && (
              <span
                className="inline-flex h-[18px] shrink-0 items-center gap-[4px] rounded-[9px] bg-ds-amber-2 px-[6px] text-[11px] leading-none font-semibold text-ds-amber"
                aria-label={elsewhereLabel}
                title={elsewhereLabel}
              >
                <span className="size-[6px] rounded-full bg-ds-amber" aria-hidden="true" />
                {elsewhere}
              </span>
            )}
            <ChevronsUpDown size={14} className="shrink-0 text-ds-text-3" aria-hidden="true" />
          </>
        )}
      </button>
    </div>
  )
}

type Connecting =
  { target: string; state: 'busy' } | { target: string; state: 'error'; message: string }

const ADD = 'add'

/** The menu of X accounts, opened above the switcher. Arrow keys move between its items. */
function AccountMenu({
  status,
  activeId,
  pending,
  onClose
}: {
  status: AuthStatus
  activeId: string
  pending: Record<string, number>
  onClose: () => void
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [connecting, setConnecting] = useState<Connecting | null>(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => void (live.current = false)
  }, [])

  // Opens on the active account, so Enter keeps it and the arrows move from there.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  }, [])

  function items(): HTMLElement[] {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitemradio"], [role="menuitem"]:not([disabled])'
      ) ?? []
    )
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const all = items()
    const at = all.indexOf(document.activeElement as HTMLElement)
    all[(at + step + all.length) % all.length]?.focus()
  }

  function choose(id: string): void {
    if (id !== activeId) void window.opencat.auth.setActive(id).catch(() => undefined)
    onClose()
  }

  function connect(target: string): void {
    setConnecting({ target, state: 'busy' })
    window.opencat.auth
      .connect()
      .then(() => live.current && onClose())
      .catch(
        (err: unknown) =>
          live.current && setConnecting({ target, state: 'error', message: authErrorMessage(err) })
      )
  }

  const busy = connecting?.state === 'busy'
  const errorFor = (target: string): string | null =>
    connecting?.state === 'error' && connecting.target === target ? connecting.message : null

  return (
    <div
      ref={menuRef}
      className="absolute bottom-[calc(100%+6px)] left-0 z-50 box-border flex w-[256px] flex-col gap-[2px] rounded-[12px] border border-ds-border-strong bg-ds-surface p-[6px] shadow-[0_12px_32px_#00000080]"
      role="menu"
      aria-label="X accounts"
      onKeyDown={onKeyDown}
    >
      <div
        className="px-[8px] pt-[6px] pb-[4px] text-[10px] font-semibold tracking-[0.8px] text-ds-text-3"
        aria-hidden="true"
      >
        X ACCOUNTS
      </div>
      {status.accounts.map((account, i) => {
        const current = account.id === activeId
        const waiting = pending[account.id] ?? 0
        const error = errorFor(account.id)
        return (
          <div key={account.id} role="none">
            <div
              className={`flex h-[44px] items-center gap-[10px] rounded-[8px] px-[8px] ${current ? 'bg-ds-raised' : 'hover:bg-[color-mix(in_srgb,var(--ds-raised)_60%,transparent)] has-[button:focus-visible]:bg-[color-mix(in_srgb,var(--ds-raised)_60%,transparent)]'}`}
              role="none"
            >
              <button
                type="button"
                className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-[10px] border-0 bg-transparent p-0 text-left font-sans outline-none"
                role="menuitemradio"
                aria-checked={current}
                onClick={() => choose(account.id)}
              >
                <Avatar account={account} index={i} size={28} />
                <span className="flex min-w-0 flex-1 flex-col [&>*]:truncate">
                  <span className="text-[13px] font-medium text-ds-text">
                    {accountName(account)}
                  </span>
                  {account.needsReconnect ? (
                    <span className="text-[11px] text-ds-red">Needs reconnecting</span>
                  ) : (
                    <span className="text-[11px] text-ds-text-3">@{account.handle}</span>
                  )}
                </span>
                {waiting > 0 && <CountPill count={waiting} label={`${waiting} waiting`} />}
                {current && (
                  <Check size={14} className="shrink-0 text-ds-accent-text" aria-hidden="true" />
                )}
              </button>
              {account.needsReconnect && (
                <button
                  type="button"
                  className="shrink-0 cursor-pointer border-0 bg-transparent p-0 font-sans text-[12px] font-medium text-ds-accent-text disabled:cursor-default disabled:text-ds-text-3"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => connect(account.id)}
                >
                  {busy && connecting.target === account.id ? 'Connecting…' : 'Reconnect'}
                </button>
              )}
            </div>
            {error && (
              <p
                className="m-0 px-[8px] pb-[6px] text-[11px] leading-[1.4] text-ds-red"
                role="alert"
              >
                {error}
              </p>
            )}
          </div>
        )
      })}
      <div className="mx-[2px] my-[4px] h-px bg-ds-border" role="separator" />
      <button
        type="button"
        className="flex h-[36px] cursor-pointer items-center gap-[10px] rounded-[8px] border-0 bg-transparent px-[8px] text-left font-sans hover:bg-[color-mix(in_srgb,var(--ds-raised)_60%,transparent)] disabled:cursor-default"
        role="menuitem"
        disabled={busy}
        onClick={() => connect(ADD)}
      >
        <span
          className="grid size-[28px] shrink-0 place-items-center rounded-full border border-ds-border-strong text-ds-text-2 box-border"
          aria-hidden="true"
        >
          <Plus size={14} />
        </span>
        <span className="text-[13px] font-medium text-ds-text-2">
          {busy && connecting.target === ADD ? 'Connecting…' : 'Add account'}
        </span>
      </button>
      {errorFor(ADD) && (
        <p className="m-0 px-[8px] pb-[4px] text-[11px] leading-[1.4] text-ds-red" role="alert">
          {errorFor(ADD)}
        </p>
      )}
    </div>
  )
}
