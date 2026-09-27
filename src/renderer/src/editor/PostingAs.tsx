import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import type { XAccount } from '@shared/api'
import { Avatar } from '../shell/AccountSwitcher'

/**
 * The editor's "Posting as" chip (OP-60): the X account the post goes out from, and a menu of the
 * signed-in accounts to move it to another. A post already on X shows the chip alone.
 */
export function PostingAs({
  accounts,
  selectedId,
  readOnly,
  lockedReason,
  onChange
}: {
  accounts: XAccount[]
  selectedId: string
  readOnly: boolean
  /** Why a post that isn't read-only still can't change account, shown on the chip. */
  lockedReason?: string
  onChange: (accountId: string) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = accounts.find((a) => a.id === selectedId)

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    const onDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!selected) return null

  const chip = (
    <>
      <Avatar account={selected} index={accounts.indexOf(selected)} size={20} />
      <span className="max-w-[160px] truncate text-[12px] font-medium text-ds-text-2">
        @{selected.handle}
      </span>
    </>
  )
  const chipClass =
    'box-border flex h-[26px] shrink-0 items-center gap-[6px] rounded-[13px] border border-ds-border-strong bg-ds-raised py-0 pr-[10px] pl-[3px] font-sans'

  if (readOnly) {
    return (
      <span className={chipClass} title={lockedReason ?? `Posted as @${selected.handle}`}>
        <span className="sr-only">{lockedReason ? 'Posting as' : 'Posted as'}</span>
        {chip}
      </span>
    )
  }

  function close(): void {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') {
      // Closes only the menu, not the editor around it.
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not([disabled])') ?? []
    )
    const at = items.indexOf(document.activeElement as HTMLElement)
    items[(at + step + items.length) % items.length]?.focus()
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        className={`${chipClass} cursor-pointer`}
        aria-label={`Posting as @${selected.handle}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {chip}
        <ChevronDown size={12} className="text-ds-text-3" aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="absolute top-[calc(100%+6px)] right-0 z-10 box-border flex w-[220px] flex-col gap-[2px] rounded-[12px] border border-ds-border-strong bg-ds-surface p-[6px] shadow-[0_12px_32px_#00000080]"
          role="menu"
          aria-label="Post from"
          onKeyDown={onKeyDown}
        >
          {accounts.map((account, i) => {
            const current = account.id === selectedId
            return (
              <button
                key={account.id}
                type="button"
                className={`flex h-[40px] cursor-pointer items-center gap-[10px] rounded-[8px] border-0 px-[8px] text-left font-sans outline-none disabled:cursor-default disabled:opacity-60 ${current ? 'bg-ds-raised' : 'bg-transparent hover:bg-[color-mix(in_srgb,var(--ds-raised)_60%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--ds-raised)_60%,transparent)]'}`}
                role="menuitemradio"
                aria-checked={current}
                // X won't take a post from an account that is signed out.
                disabled={account.needsReconnect}
                onClick={() => {
                  onChange(account.id)
                  close()
                }}
              >
                <Avatar account={account} index={i} size={22} />
                <span className="flex min-w-0 flex-1 flex-col [&>*]:truncate">
                  <span className="text-[12px] font-medium text-ds-text">@{account.handle}</span>
                  {account.needsReconnect && (
                    <span className="text-[11px] text-ds-red">Needs reconnecting</span>
                  )}
                </span>
                {current && (
                  <Check size={14} className="shrink-0 text-ds-accent-text" aria-hidden="true" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
