import { useEffect, useRef, useState } from 'react'
import { Pencil, SquarePen, Trash2 } from 'lucide-react'
import type { ChatSession } from '@shared/api'
import { lastActivity } from './lastActivity'
import { newChatShortcut } from '../shortcuts'

/** Main refuses longer names; the field stops there first. */
const MAX_TITLE = 80

const ICON_BUTTON =
  'grid size-[20px] shrink-0 cursor-pointer place-items-center rounded-[4px] border-0 bg-transparent p-0 text-ds-text-3 outline-none hover:text-ds-text focus-visible:text-ds-text focus-visible:ring-1 focus-visible:ring-ds-accent aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:text-ds-text-3'

type Editing = { id: string; mode: 'rename' | 'delete' } | null

/**
 * The chat list under the agent panel's title (Pencil "OP-95 · Sessions menu"): a new chat, then
 * the account's chats newest first, each renamed or deleted in place. Up and down move between
 * rows, left and right between a row's buttons; Escape or a click outside closes it.
 */
export function SessionMenu({
  sessions,
  handle,
  error,
  triggerRef,
  onNew,
  onSelect,
  onRename,
  onDelete,
  onClose
}: {
  sessions: ChatSession[]
  handle: string | null
  /** Why opening or making a chat failed. */
  error: string | null
  /** The title button, whose clicks toggle the menu rather than count as outside. */
  triggerRef: React.RefObject<HTMLElement | null>
  onNew: () => void
  onSelect: (id: string) => void
  /** Rejects with main's message, shown under the row. */
  onRename: (id: string, title: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  /** `refocus` puts focus back on the title button, after a key rather than a click. */
  onClose: (refocus: boolean) => void
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState<Editing>(null)
  // Main's refusal of a rename or delete, under that row.
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const shortcut = newChatShortcut()

  // Opens on the open chat, so Enter keeps it and the arrows move from there.
  useEffect(() => {
    const menu = menuRef.current
    const current = menu?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
    ;(current ?? menu?.querySelector<HTMLElement>('[role="menuitem"]'))?.focus()
  }, [])

  // A click outside closes it; the title button toggles it itself.
  useEffect(() => {
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      onClose(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose, triggerRef])

  // The rows' own items: New chat and each chat's main button, in order.
  function rows(): HTMLElement[] {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[data-menu-row]') ?? []
    ).filter((el) => !el.hasAttribute('disabled'))
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    // The rename field keeps its keys: Enter and Escape are its own, arrows move the caret.
    if (event.target instanceof HTMLInputElement) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (editing) setEditing(null)
      else onClose(true)
      return
    }
    const focused = document.activeElement as HTMLElement | null
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const row = focused?.closest('[data-row]')
      if (!row) return
      event.preventDefault()
      const items = Array.from(row.querySelectorAll<HTMLElement>('button'))
      const at = items.indexOf(focused as HTMLElement)
      const step = event.key === 'ArrowRight' ? 1 : -1
      items[(at + step + items.length) % items.length]?.focus()
      return
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const all = rows()
    const own = focused?.closest('[data-row]')?.querySelector<HTMLElement>('[data-menu-row]')
    const at = all.indexOf(own ?? (focused as HTMLElement))
    all[at === -1 ? 0 : (at + step + all.length) % all.length]?.focus()
  }

  const startEdit = (id: string, mode: 'rename' | 'delete'): void => {
    setRowError(null)
    setEditing({ id, mode })
  }

  return (
    <div
      ref={menuRef}
      className="absolute top-[64px] left-[10px] z-20 box-border flex w-[min(320px,calc(100%-20px))] flex-col gap-[2px] rounded-[12px] border border-ds-border-strong bg-ds-surface p-[6px] shadow-[0_12px_32px_#00000080]"
      role="menu"
      aria-label="Chats"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="box-border flex h-[36px] w-full shrink-0 cursor-pointer items-center gap-[8px] rounded-[8px] border-0 bg-transparent px-[10px] text-left font-sans text-ds-accent-text outline-none hover:bg-[color-mix(in_srgb,var(--ds-raised)_60%,transparent)] focus-visible:bg-ds-raised"
        role="menuitem"
        data-menu-row
        onClick={onNew}
      >
        <SquarePen size={14} className="shrink-0" aria-hidden="true" />
        <span className="flex-1 text-[13px] font-medium">New chat</span>
        <span className="font-mono text-[11px] text-ds-text-3" aria-hidden="true">
          {shortcut}
        </span>
      </button>
      <div className="h-px w-full shrink-0 bg-ds-border" role="separator" />
      <div
        className="px-[10px] pt-[6px] pb-[4px] text-[10px] font-semibold tracking-[0.8px] text-ds-text-3 uppercase"
        aria-hidden="true"
      >
        {handle ? `Chats for @${handle}` : 'Chats'}
      </div>
      {error && (
        <p className="m-0 px-[10px] pb-[4px] text-[11px] leading-[1.4] text-ds-red" role="alert">
          {error}
        </p>
      )}
      <div className="flex max-h-[min(420px,calc(100vh-200px))] flex-col gap-[2px] overflow-y-auto">
        {sessions.map((session) => (
          <div key={session.id} role="none" className="flex flex-col">
            {editing?.id === session.id && editing.mode === 'rename' ? (
              <RenameRow
                session={session}
                onSave={async (title) => {
                  try {
                    await onRename(session.id, title)
                    setEditing(null)
                    setRowError(null)
                  } catch (err) {
                    setRowError({ id: session.id, message: (err as Error).message })
                  }
                }}
                onCancel={() => {
                  setEditing(null)
                  setRowError(null)
                }}
              />
            ) : editing?.id === session.id && editing.mode === 'delete' ? (
              <DeleteRow
                session={session}
                onCancel={() => setEditing(null)}
                onDelete={async () => {
                  try {
                    await onDelete(session.id)
                    setEditing(null)
                  } catch (err) {
                    setEditing(null)
                    setRowError({ id: session.id, message: (err as Error).message })
                  }
                }}
              />
            ) : (
              <SessionRow
                session={session}
                onSelect={() => onSelect(session.id)}
                onRename={() => startEdit(session.id, 'rename')}
                onDelete={() => startEdit(session.id, 'delete')}
              />
            )}
            {rowError?.id === session.id && (
              <p
                className="m-0 px-[10px] pt-[2px] pb-[4px] text-[11px] leading-[1.4] text-ds-red"
                role="alert"
              >
                {rowError.message}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** One chat: a streaming dot, its title and when it was last written in; hover shows its tools. */
function SessionRow({
  session,
  onSelect,
  onRename,
  onDelete
}: {
  session: ChatSession
  onSelect: () => void
  onRename: () => void
  onDelete: () => void
}): React.JSX.Element {
  const current = session.active
  // Main refuses to delete a chat the agent is answering in; say so before the click.
  const busy = session.streaming
  const shown = current
    ? 'opacity-100'
    : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
  return (
    <div
      className={`group relative box-border flex h-[38px] w-full shrink-0 items-center gap-[8px] rounded-[8px] px-[10px] ${current ? 'bg-ds-raised' : 'hover:bg-[color-mix(in_srgb,var(--ds-raised)_60%,transparent)] has-[[data-menu-row]:focus-visible]:bg-[color-mix(in_srgb,var(--ds-raised)_60%,transparent)]'}`}
      role="none"
      data-row
      data-testid={`chat-row-${session.id}`}
    >
      {/* The whole row opens the chat; the title and time are drawn over it. */}
      <button
        type="button"
        className="absolute inset-0 cursor-pointer rounded-[8px] border-0 bg-transparent p-0 outline-none"
        role="menuitemradio"
        aria-checked={current}
        aria-label={busy ? `${session.title}, answering` : session.title}
        data-menu-row
        onClick={onSelect}
      />
      {busy && (
        <span
          className="pointer-events-none relative size-[6px] shrink-0 rounded-full bg-ds-accent"
          data-testid="chat-streaming"
          aria-hidden="true"
        />
      )}
      <span
        className={`pointer-events-none relative min-w-0 flex-1 truncate text-[13px] ${current ? 'text-ds-text' : 'text-ds-text-2'}`}
      >
        {session.title}
      </span>
      <span className={`relative flex items-center gap-[4px] ${shown}`}>
        <button
          type="button"
          className={ICON_BUTTON}
          role="menuitem"
          aria-label={`Rename ${session.title}`}
          title="Rename"
          onClick={onRename}
        >
          <Pencil size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={ICON_BUTTON}
          role="menuitem"
          aria-label={`Delete ${session.title}`}
          aria-disabled={busy || undefined}
          title={busy ? 'Wait for the reply to finish' : 'Delete'}
          onClick={() => {
            if (!busy) onDelete()
          }}
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </span>
      <span className="pointer-events-none relative shrink-0 font-mono text-[11px] text-ds-text-3">
        {lastActivity(session.updatedAt)}
      </span>
    </div>
  )
}

/** The row as a name field: Enter or leaving it saves, Escape keeps the old name. */
function RenameRow({
  session,
  onSave,
  onCancel
}: {
  session: ChatSession
  onSave: (title: string) => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState(session.title)
  // Enter saves, then the field unmounts and blurs: one save, not two.
  const settled = useRef(false)
  const save = (): void => {
    if (settled.current) return
    if (title === session.title) {
      settled.current = true
      onCancel()
      return
    }
    settled.current = true
    void onSave(title).finally(() => {
      // Still here after a refusal: the next Enter or blur tries again.
      settled.current = false
    })
  }
  return (
    <div
      className="box-border flex h-[38px] w-full shrink-0 items-center gap-[8px] px-[10px]"
      role="none"
    >
      <input
        className="box-border h-[28px] min-w-0 flex-1 rounded-[6px] border-0 bg-ds-inset px-[8px] font-sans text-[13px] text-ds-text outline outline-1 -outline-offset-1 outline-ds-accent"
        aria-label="Chat name"
        value={title}
        maxLength={MAX_TITLE}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          // Switching to another app blurs the field too; it is still being edited on return.
          if (document.hasFocus()) save()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            settled.current = true
            onCancel()
          }
        }}
      />
      <span className="shrink-0 font-mono text-[10px] text-ds-text-3" aria-hidden="true">
        Enter
      </span>
    </div>
  )
}

/** The row as a question: delete this chat and its messages, or keep it. */
function DeleteRow({
  session,
  onCancel,
  onDelete
}: {
  session: ChatSession
  onCancel: () => void
  onDelete: () => Promise<void>
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // Focus starts on Cancel: Enter straight away keeps the chat.
  useEffect(() => cancelRef.current?.focus(), [])
  return (
    <div
      className="box-border flex w-full shrink-0 flex-col gap-[8px] rounded-[8px] border border-ds-red bg-ds-red-2 px-[10px] py-[8px]"
      role="group"
      aria-label={`Delete ${session.title}`}
      data-row
    >
      <p className="m-0 text-[12px] leading-[1.4] text-ds-text [overflow-wrap:anywhere]">
        Delete &ldquo;{session.title}&rdquo;? Its messages go too.
      </p>
      <span className="flex justify-end gap-[6px]">
        <button
          ref={cancelRef}
          type="button"
          className="box-border h-[26px] cursor-pointer rounded-[6px] border border-ds-border-strong bg-transparent px-[10px] font-sans text-[12px] font-medium text-ds-text hover:bg-ds-raised"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="box-border h-[26px] cursor-pointer rounded-[6px] border-0 bg-ds-red px-[10px] font-sans text-[12px] font-medium text-white disabled:cursor-default disabled:opacity-60"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void onDelete().finally(() => setBusy(false))
          }}
        >
          Delete
        </button>
      </span>
    </div>
  )
}
