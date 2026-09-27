import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Plus } from 'lucide-react'
import type { LocalDate, Post, PostMedia } from '@shared/api'
import type { NewPostSeed } from './editorContext'
import { postUrl } from '../day/columns'
import { useActiveAccount } from '../shell/useActiveAccount'
import { PostingAs } from './PostingAs'
import {
  MAX_PARTS,
  draftFromPost,
  emptyPart,
  firstEditable,
  mediaProblem,
  movePart,
  partProblem,
  toPayload,
  type DraftPart
} from './draft'
import { PartEditor } from './PartEditor'
import type { MediaImport } from '../media/useMediaImport'
import { fileSources } from '../media/fileSources'
import { measureText } from './postText'
import { defaultFields, fromFields, isPast, toFields, type DateTimeFields } from './schedule'
import { Button } from '../ui'

interface PostEditorProps {
  /** The post to edit, or null for a new one. */
  post: Post | null
  /** The day a new post starts on. */
  day?: LocalDate
  /**
   * Media a new post starts with. It isn't one of the editor's own imports, so closing without
   * saving leaves it where it came from (the chat's render) instead of discarding it.
   */
  seed?: NewPostSeed
  focus: 'text' | 'time'
  onClose: () => void
}

type Confirm = 'delete' | 'discard' | 'duplicate' | null

/** Strips Electron's IPC wrapper so the user reads only what main said. */
function messageOf(err: unknown): string {
  return err instanceof Error
    ? err.message.replace(/^Error invoking remote method '[^']+': /, '')
    : String(err)
}

/**
 * Writes, edits, reschedules and deletes a post or a thread, with media. It never talks to X:
 * Post now sets the time to now and the publisher sends it on its next tick.
 */
export function PostEditor({
  post,
  day,
  seed,
  focus,
  onClose
}: PostEditorProps): React.JSX.Element {
  // The rest of a thread that is partly on X has to reply from the same account (OP-60).
  const partlyOnX = post?.parts.some((part) => part.remoteId !== null) ?? false
  const readOnly =
    post?.status === 'posting' || post?.status === 'posted' || post?.status === 'rejected'
  const pending = post?.status === 'pending_approval'
  const [initial] = useState(() => ({
    parts: draftFromPost(post, seed?.media),
    when: post ? toFields(new Date(post.scheduledAt)) : defaultFields(day, new Date())
  }))

  const [parts, setParts] = useState<DraftPart[]>(initial.parts)
  const [when, setWhen] = useState<DateTimeFields>(initial.when)
  const [problem, setProblem] = useState<string | null>(null)
  const [partProblems, setPartProblems] = useState<Record<string, string>>({})
  /** Imports still pending across the parts; saving waits for them. */
  const [importing, setImporting] = useState(0)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  // The X account it goes out from (OP-60): null until the user picks one, meaning the post's own
  // account, or the active one for a new post (or a post from before any account).
  const [accountId, setAccountId] = useState<string | null>(null)
  const { status: auth, active } = useActiveAccount()
  const shownAccountId = accountId ?? post?.accountId ?? active?.id ?? null
  const moved = accountId !== null && accountId !== (post?.accountId ?? active?.id)

  /** Media imported while the editor is open. What isn't saved on the post is discarded. */
  const imported = useRef(new Set<string>())
  const firstTextRef = useRef<HTMLTextAreaElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const target = readOnly
      ? dialogRef.current
      : focus === 'time'
        ? dateRef.current
        : firstTextRef.current
    target?.focus()
  }, [focus, readOnly])

  const editableFrom = firstEditable(parts)
  const anyOver = parts.some((part) => !part.locked && measureText(part.text).over)
  const dirty =
    JSON.stringify(toPayload(parts)) !== JSON.stringify(toPayload(initial.parts)) ||
    when.date !== initial.when.date ||
    when.time !== initial.when.time ||
    moved
  const title = readOnly
    ? post?.status === 'posted'
      ? 'Posted'
      : post?.status === 'rejected'
        ? 'Rejected'
        : 'Posting'
    : post
      ? parts.length > 1
        ? 'Edit thread'
        : 'Edit post'
      : parts.length > 1
        ? 'New thread'
        : 'New post'

  function discardImports(keep: Set<string>): void {
    for (const id of imported.current) {
      if (!keep.has(id)) void window.opencat.media.discard(id).catch(() => {})
    }
    imported.current.clear()
  }

  function close(): void {
    discardImports(new Set())
    onClose()
  }

  function requestClose(): void {
    if (dirty && !readOnly && confirm !== 'discard') setConfirm('discard')
    else close()
  }

  function updatePart(key: string, change: (part: DraftPart) => DraftPart): void {
    setParts((current) => current.map((part) => (part.key === key ? change(part) : part)))
    setProblem(null)
    setPartProblems((all) => without(all, key))
  }

  async function attach(
    key: string,
    importer: MediaImport,
    load: () => Promise<PostMedia[]>,
    paths?: string[]
  ): Promise<void> {
    setImporting((n) => n + 1)
    setPartProblems((all) => without(all, key))
    try {
      // What main refuses, or a cancel, ends up in the part's own import row, not here.
      const added = await importer.run(load, paths)
      added.forEach((m) => imported.current.add(m.id))
      const part = parts.find((p) => p.key === key)
      if (!part || added.length === 0) return
      const issue = mediaProblem([...part.media, ...added])
      if (issue) {
        added.forEach((m) => removeImport(m.id))
        setPartProblems((all) => ({ ...all, [key]: issue }))
        return
      }
      updatePart(key, (p) => ({ ...p, media: [...p.media, ...added] }))
    } finally {
      setImporting((n) => n - 1)
    }
  }

  async function attachFiles(key: string, files: File[], importer: MediaImport): Promise<void> {
    let paths: string[]
    try {
      const found = fileSources(files)
      paths = (Array.isArray(found) ? found : await found).map((s) => s.path)
    } catch (err) {
      importer.fail(messageOf(err))
      return
    }
    await attach(key, importer, () => window.opencat.media.import(paths), paths)
  }

  function removeImport(id: string): void {
    if (!imported.current.delete(id)) return
    void window.opencat.media.discard(id).catch(() => {})
  }

  function removeMedia(key: string, id: string): void {
    // Media saved on the post is removed by main when the post is saved without it.
    removeImport(id)
    updatePart(key, (p) => ({ ...p, media: p.media.filter((m) => m.id !== id) }))
  }

  function removePart(key: string): void {
    const part = parts.find((p) => p.key === key)
    part?.media.forEach((m) => removeImport(m.id))
    setParts((current) => (current.length > 1 ? current.filter((p) => p.key !== key) : current))
    setPartProblems((all) => without(all, key))
  }

  async function run(action: () => Promise<unknown>, keep: Set<string>): Promise<void> {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      discardImports(keep)
      onClose()
    } catch (err) {
      setProblem(messageOf(err))
      setBusy(false)
    }
  }

  function firstProblem(): boolean {
    const found: Record<string, string> = {}
    parts.forEach((part, i) => {
      if (part.locked) return
      const issue = partProblem(part, i, parts.length)
      if (issue) found[part.key] = issue
    })
    setPartProblems(found)
    return Object.keys(found).length > 0
  }

  function send(scheduledAt: string, approve = false): void {
    const payload = toPayload(parts)
    const keep = new Set(payload.flatMap((part) => (part.media ?? []).map((m) => m.id)))
    void run(async () => {
      const account = moved && accountId ? { accountId } : {}
      if (!post) return window.opencat.posts.create({ parts: payload, scheduledAt, ...account })
      // A pending post stays pending when saved; approving is a separate step after it.
      const saved = await window.opencat.posts.update(post.id, {
        parts: payload,
        scheduledAt,
        ...account
      })
      return approve ? window.opencat.posts.approve(saved.id) : saved
    }, keep)
  }

  function save(approve = false): void {
    if (firstProblem()) return
    const at = fromFields(when)
    if (!at) return setProblem('Pick a date and a time.')
    if (isPast(at, new Date())) {
      return setProblem('That time has already passed. Pick a later one, or use Post now.')
    }
    send(at.toISOString(), approve)
  }

  function postNow(): void {
    if (firstProblem()) return
    if (post?.errorCode === 'uncertain' && confirm !== 'duplicate') return setConfirm('duplicate')
    send(new Date().toISOString())
  }

  function remove(): void {
    if (!post) return
    if (confirm !== 'delete') return setConfirm('delete')
    void run(() => window.opencat.posts.delete(post.id), new Set())
  }

  function addPart(): void {
    setParts((current) => (current.length < MAX_PARTS ? [...current, emptyPart()] : current))
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (confirm) setConfirm(null)
      else requestClose()
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !readOnly) {
      event.preventDefault()
      save()
    } else if (event.key === 'Tab') {
      trapFocus(event, dialogRef.current)
    }
  }

  const url = post && post.status === 'posted' ? postUrl(post) : null
  const firstEditableKey = parts[editableFrom]?.key

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-black/65 p-8"
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[calc(100vh-64px)] w-[min(640px,calc(100vw-64px))] flex-col overflow-hidden rounded-2xl border border-ds-border-strong bg-ds-surface text-ds-text shadow-[0_24px_60px_rgba(0,0,0,0.5)] outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-ds-border px-5 py-4">
          <h2 id="editor-title" className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold">
            {title}
          </h2>
          {/* Which account it goes out from, once there is more than one to choose (OP-60). */}
          {auth && auth.accounts.length > 1 && shownAccountId && (
            <PostingAs
              accounts={auth.accounts}
              selectedId={shownAccountId}
              readOnly={readOnly || partlyOnX}
              lockedReason={
                partlyOnX
                  ? 'Part of this thread is already on X, so the rest goes out from this account'
                  : undefined
              }
              onChange={(id) => {
                setAccountId(id)
                setProblem(null)
              }}
            />
          )}
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
          {pending && (
            <p
              className="m-0 rounded-lg bg-ds-amber-2 px-3 py-2 text-[13px] text-ds-amber"
              role="status"
            >
              Written by the agent and waiting for your approval. Saving keeps it waiting.
            </p>
          )}
          {post?.status === 'failed' && post.error && (
            <p className="m-0 text-[13px] text-ds-red" role="alert">
              {post.error}
            </p>
          )}

          {readOnly ? (
            <ReadOnlyParts post={post!} />
          ) : (
            <>
              {parts.map((part, i) => (
                <PartEditor
                  key={part.key}
                  part={part}
                  index={i}
                  count={parts.length}
                  canMoveUp={i > editableFrom}
                  canMoveDown={!part.locked && i < parts.length - 1}
                  problem={partProblems[part.key] ?? null}
                  textRef={part.key === firstEditableKey ? firstTextRef : undefined}
                  onText={(text) => updatePart(part.key, (p) => ({ ...p, text }))}
                  onMove={(step) => setParts((current) => movePart(current, i, step))}
                  onRemove={() => removePart(part.key)}
                  onPick={(importer) =>
                    void attach(part.key, importer, () => window.opencat.media.pick())
                  }
                  onFiles={(files, importer) => void attachFiles(part.key, files, importer)}
                  onRemoveMedia={(id) => removeMedia(part.key, id)}
                  onAlt={(id, alt) =>
                    updatePart(part.key, (p) => ({
                      ...p,
                      media: p.media.map((m) => (m.id === id ? { ...m, alt } : m))
                    }))
                  }
                />
              ))}
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-1 text-[13px] font-medium text-ds-accent-text disabled:cursor-default disabled:text-ds-text-3"
                disabled={parts.length >= MAX_PARTS}
                onClick={addPart}
              >
                {parts.length >= MAX_PARTS ? (
                  `Threads stop at ${MAX_PARTS} posts`
                ) : (
                  <>
                    <Plus size={14} aria-hidden="true" />
                    Add to thread
                  </>
                )}
              </button>
            </>
          )}

          {readOnly ? (
            <p className="m-0 text-[13px] leading-[1.5] text-ds-text-2">
              {post?.status === 'posted' && post.postedAt
                ? `Posted ${format(new Date(post.postedAt), "EEEE d MMMM yyyy 'at' HH:mm")}.`
                : `Scheduled for ${format(new Date(post!.scheduledAt), "EEEE d MMMM yyyy 'at' HH:mm")}, now posting.`}{' '}
              X does not allow editing a post through its API.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2.5 border-t border-ds-border pt-3 [&_label]:flex [&_label]:items-center [&_label]:gap-2 [&_label]:text-[12px] [&_label]:font-medium [&_label]:text-ds-text-3">
              <label>
                Date
                <input
                  ref={dateRef}
                  type="date"
                  className="h-8 rounded-lg border border-ds-border-strong bg-ds-inset px-2.5 font-sans text-[13px] text-ds-text [color-scheme:dark]"
                  value={when.date}
                  onChange={(e) => {
                    setWhen({ ...when, date: e.target.value })
                    setProblem(null)
                  }}
                />
              </label>
              <label>
                Time
                <input
                  type="time"
                  className="h-8 rounded-lg border border-ds-border-strong bg-ds-inset px-2.5 font-sans text-[13px] text-ds-text [color-scheme:dark] font-mono"
                  value={when.time}
                  onChange={(e) => {
                    setWhen({ ...when, time: e.target.value })
                    setProblem(null)
                  }}
                />
              </label>
            </div>
          )}

          {problem && (
            <p className="m-0 text-[13px] text-ds-red" role="alert">
              {problem}
            </p>
          )}
        </div>

        {confirm && (
          <div
            className="flex shrink-0 flex-col gap-2.5 border-t border-ds-border bg-ds-raised px-5 py-3.5 text-[13px] [&>p]:m-0"
            role="alertdialog"
            aria-label="Confirm"
          >
            {confirm === 'delete' && <p>Delete this post? This can&apos;t be undone.</p>}
            {confirm === 'discard' && <p>Close without saving your changes?</p>}
            {confirm === 'duplicate' && (
              <p>
                This post may already be on X, because the app closed while posting it. Check your
                profile first, or it may go out twice.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirm(null)}>
                {confirm === 'discard' ? 'Keep editing' : 'Cancel'}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={confirm === 'delete' ? remove : confirm === 'discard' ? close : postNow}
              >
                {confirm === 'delete'
                  ? 'Delete'
                  : confirm === 'discard'
                    ? 'Discard'
                    : 'Post anyway'}
              </Button>
            </div>
          </div>
        )}

        {!confirm && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-ds-border bg-ds-raised px-5 py-3.5">
            {post && !readOnly && (
              <Button
                type="button"
                variant="ghost"
                className="mr-auto !text-ds-red"
                disabled={busy}
                onClick={remove}
              >
                Delete
              </Button>
            )}
            {url && (
              <a
                className="mr-auto text-[13px] text-ds-accent-text no-underline"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                View on X
              </a>
            )}
            <Button type="button" variant="ghost" onClick={requestClose}>
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly && !pending && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || importing > 0}
                  onClick={postNow}
                >
                  Post now
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy || anyOver || importing > 0}
                  onClick={() => save()}
                >
                  {post ? 'Save' : 'Schedule'}
                </Button>
              </>
            )}
            {pending && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || anyOver || importing > 0}
                  onClick={() => save()}
                >
                  Save
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={busy || anyOver || importing > 0}
                  onClick={() => save(true)}
                >
                  Save and approve
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ReadOnlyParts({ post }: { post: Post }): React.JSX.Element {
  const parts = draftFromPost(post).map((part) => ({ ...part, locked: true }))
  return (
    <>
      {parts.map((part, i) => (
        <PartEditor
          key={part.key}
          part={part}
          index={i}
          count={parts.length}
          canMoveUp={false}
          canMoveDown={false}
          problem={null}
          onText={() => {}}
          onMove={() => {}}
          onRemove={() => {}}
          onPick={() => {}}
          onFiles={() => {}}
          onRemoveMedia={() => {}}
          onAlt={() => {}}
        />
      ))}
    </>
  )
}

function trapFocus(event: React.KeyboardEvent, dialog: HTMLElement | null): void {
  if (!dialog) return
  const focusable = dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), textarea:not([readonly])'
  )
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function without(all: Record<string, string>, key: string): Record<string, string> {
  const rest = { ...all }
  delete rest[key]
  return rest
}
