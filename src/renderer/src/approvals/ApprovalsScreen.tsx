import { useEffect, useRef, useState } from 'react'
import { format, isToday, isTomorrow } from 'date-fns'
import { CalendarClock, Check, CheckCheck, Clock, Trash2 } from 'lucide-react'
import { useSearchParams } from 'react-router'
import type { Post, PostAuthor } from '@shared/api'
import { toLocalDate } from '../calendar/grid'
import { isLate } from '../day/columns'
import { useEditor } from '../editor/editorContext'
import { ViewButton } from '../media/ViewButton'
import { useMediaViewer, viewerItemsForPost } from '../media/viewerContext'
import { TOOLBAR_COMPACT_BELOW, useElementWidth } from '../shell/layout'
import { onPostsOrAccountChanged } from '../shell/useActiveAccount'
import { Button, Segmented, SegmentedItem } from '../ui'

type Tab = 'waiting' | 'rejected'

const messageOf = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(
    /^Error invoking remote method '[^']+': (\w*Error: )?/,
    ''
  )

const SOURCE: Record<PostAuthor, string> = { agent: 'by Agent', mcp: 'via MCP', user: 'by you' }

/** Posts in one of the two tabs, fetched again whenever any post or the X account changes. */
function usePosts(tab: Tab): { posts: Post[] | null; error: string | null } {
  // Kept with the tab they're for, so switching tabs never shows the other tab's posts.
  const [loaded, setLoaded] = useState<{ tab: Tab; posts: Post[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    const load = (): void => {
      const call =
        tab === 'waiting'
          ? window.opencat.posts.listPending()
          : window.opencat.posts.listByStatus('rejected')
      call
        .then((result) => {
          if (!current) return
          setLoaded({ tab, posts: result })
          setError(null)
        })
        .catch((err: unknown) => current && setError(messageOf(err)))
    }
    load()
    const stop = onPostsOrAccountChanged(load)
    return () => {
      current = false
      stop()
    }
  }, [tab])
  return { posts: loaded?.tab === tab ? loaded.posts : null, error }
}

/** "Today", "Tomorrow" or the weekday, and the date with how many posts. */
function dayHeading(day: Date, count: number): { title: string; sub: string } {
  const title = isToday(day) ? 'Today' : isTomorrow(day) ? 'Tomorrow' : format(day, 'EEEE')
  const sub = `${format(day, isToday(day) || isTomorrow(day) ? 'EEE d MMM' : 'd MMM')}${count > 1 ? ` · ${count} posts` : ''}`
  return { title, sub }
}

/**
 * Everything the agent or an MCP client wrote that waits for the user (boss, DM 583), and what
 * they turned down. Nothing on the Waiting tab goes out until it's approved.
 */
export function ApprovalsScreen(): React.JSX.Element {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'rejected' ? 'rejected' : 'waiting'
  // Opened from a chat card: that post is scrolled to and highlighted.
  const selected = params.get('post')
  const { posts, error } = usePosts(tab)
  const [counts, setCounts] = useState({ waiting: 0, rejected: 0 })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // On a narrow main card the hint line goes, so the tabs and "Approve N" stay on one line.
  const screenRef = useRef<HTMLElement>(null)
  const compact = useElementWidth(screenRef) < TOOLBAR_COMPACT_BELOW

  // The other tab's count, for its label.
  useEffect(() => {
    let current = true
    const load = (): void => {
      void Promise.all([
        window.opencat.posts.listPending(),
        window.opencat.posts.listByStatus('rejected')
      ])
        .then(([w, r]) => current && setCounts({ waiting: w.length, rejected: r.length }))
        .catch(() => undefined)
    }
    load()
    const stop = onPostsOrAccountChanged(load)
    return () => {
      current = false
      stop()
    }
  }, [])

  const now = new Date()
  const approvable = tab === 'waiting' && posts ? posts.filter((p) => !isLate(p, now)) : []

  const approveAll = async (): Promise<void> => {
    setBusy(true)
    setNote(null)
    const refused: string[] = []
    for (const post of approvable) {
      try {
        await window.opencat.posts.approve(post.id)
      } catch (err) {
        refused.push(`${format(new Date(post.scheduledAt), 'EEE HH:mm')}: ${messageOf(err)}`)
      }
    }
    setBusy(false)
    if (refused.length > 0) {
      setNote(`${approvable.length - refused.length} approved. Not approved: ${refused.join(' ')}`)
    }
  }

  const groups: { date: string; day: Date; posts: Post[] }[] = []
  for (const post of posts ?? []) {
    const day = new Date(post.scheduledAt)
    const date = toLocalDate(day)
    const last = groups.at(-1)
    if (last?.date === date) last.posts.push(post)
    else groups.push({ date, day, posts: [post] })
  }

  return (
    <main ref={screenRef} className="flex h-full min-h-0 flex-col">
      <header
        className={`flex h-[60px] shrink-0 items-center gap-3 overflow-hidden border-b border-ds-border ${compact ? 'px-5' : 'px-6'}`}
      >
        <h1 className="m-0 min-w-0 truncate text-[20px] font-semibold tracking-[-0.4px] whitespace-nowrap">
          Approvals
        </h1>
        <Segmented role="tablist" aria-label="Approvals" className="shrink-0">
          {(
            [
              ['waiting', 'Waiting', counts.waiting, 'text-ds-amber'],
              ['rejected', 'Rejected', counts.rejected, 'text-ds-text-3']
            ] as const
          ).map(([id, label, n, color]) => (
            <SegmentedItem
              key={id}
              role="tab"
              aria-selected={tab === id}
              aria-pressed={tab === id}
              className="flex items-center gap-1.5 whitespace-nowrap"
              onClick={() => setParams(id === 'waiting' ? {} : { tab: id })}
            >
              {label}
              <span
                className={`text-[11px] font-semibold ${tab === id ? color : 'text-ds-text-3'}`}
              >
                {n}
              </span>
            </SegmentedItem>
          ))}
        </Segmented>
        <span className="min-w-0 flex-1" />
        {!compact && (
          <p
            className="m-0 min-w-0 truncate text-[12px] text-ds-text-3"
            data-testid="approvals-hint"
          >
            {tab === 'waiting'
              ? 'Nothing the agent writes goes out until you approve it.'
              : 'Turned down, never posted. Delete them when you no longer need them.'}
          </p>
        )}
        {approvable.length >= 2 && (
          <Button
            type="button"
            variant="primary"
            className="shrink-0"
            disabled={busy}
            onClick={() => void approveAll()}
          >
            <CheckCheck size={14} aria-hidden="true" />
            {busy ? 'Approving…' : `Approve ${approvable.length}`}
          </Button>
        )}
      </header>

      <div
        className={`flex min-h-0 flex-1 flex-col gap-[22px] overflow-auto py-5 ${compact ? 'px-5' : 'px-6'}`}
      >
        {error && <p className="m-0 text-[13px] text-ds-red">Could not load posts: {error}</p>}
        {note && (
          <p className="m-0 text-[13px] text-ds-red" role="alert">
            {note}
          </p>
        )}
        {posts && posts.length === 0 && (
          <p className="m-0 py-16 text-center text-[14px] text-ds-text-3">
            {tab === 'waiting'
              ? 'Nothing waiting. Posts the agent writes show up here for you to approve.'
              : 'Nothing rejected.'}
          </p>
        )}
        {groups.map((group) => {
          const h = dayHeading(group.day, group.posts.length)
          return (
            <section
              key={group.date}
              className="flex flex-col gap-2.5"
              aria-label={`${h.title} ${h.sub}`}
            >
              <h2 className="m-0 flex min-w-0 items-center gap-2.5 text-[13px] font-semibold">
                {h.title}
                <span className="min-w-0 truncate text-[12px] font-normal text-ds-text-3">
                  {h.sub}
                </span>
              </h2>
              {group.posts.map((post) => (
                <ApprovalRow
                  key={post.id}
                  post={post}
                  late={tab === 'waiting' && isLate(post, now)}
                  selected={post.id === selected}
                />
              ))}
            </section>
          )
        })}
      </div>
    </main>
  )
}

function ApprovalRow({
  post,
  late,
  selected
}: {
  post: Post
  late: boolean
  selected: boolean
}): React.JSX.Element {
  const editor = useEditor()
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [selected])
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const rejected = post.status === 'rejected'
  const media = post.parts.flatMap((part) => part.media)
  const viewer = useMediaViewer()

  const run = (call: () => Promise<unknown>): void => {
    setBusy(true)
    setProblem(null)
    call().catch((err: unknown) => {
      setProblem(messageOf(err))
      setBusy(false)
    })
  }

  return (
    <article
      className={`flex min-w-0 items-start gap-4 rounded-xl border bg-ds-raised p-4 ${selected ? 'border-ds-accent ring-1 ring-ds-accent' : late || rejected ? 'border-ds-border' : 'border-ds-border-strong'}`}
      data-testid="approval-row"
      data-selected={selected || undefined}
      ref={ref}
    >
      <div className="flex w-16 shrink-0 flex-col gap-1">
        <time
          dateTime={post.scheduledAt}
          className={`font-mono text-[15px] font-semibold ${late || rejected ? 'text-ds-text-3' : ''} ${rejected ? 'line-through' : ''}`}
        >
          {format(new Date(post.scheduledAt), 'HH:mm')}
        </time>
        <span className="text-[11px] text-ds-text-3">{SOURCE[post.createdBy]}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {post.parts.map((part, i) => (
          <div key={part.id} className="flex min-w-0 items-start gap-2.5">
            {post.parts.length > 1 && (
              <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border border-ds-border bg-ds-inset text-[10px] font-semibold text-ds-text-3">
                {i + 1}
              </span>
            )}
            <p
              className={`m-0 min-w-0 text-[14px] leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere] ${late || rejected ? 'text-ds-text-2' : ''}`}
            >
              {part.text}
            </p>
          </div>
        ))}
        {media.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {media.map((m, i) => (
              <ViewButton
                key={m.id}
                kind={m.kind}
                onOpen={() => viewer.open(viewerItemsForPost(post), i)}
                className="size-[72px] overflow-hidden rounded-lg"
              >
                {m.kind === 'video' ? (
                  <video
                    src={m.url}
                    preload="metadata"
                    muted
                    className="block size-full object-cover"
                    aria-hidden="true"
                  />
                ) : (
                  <img src={m.url} alt={m.alt ?? ''} className="block size-full object-cover" />
                )}
              </ViewButton>
            ))}
          </div>
        )}
        {late && (
          <p className="m-0 flex items-start gap-1.5 text-[12px] text-ds-amber">
            <Clock size={13} className="mt-px shrink-0" aria-hidden="true" />
            Its time has passed. Pick a new time to approve it.
          </p>
        )}
        {problem && (
          <p className="m-0 text-[12px] [overflow-wrap:anywhere] text-ds-red" role="alert">
            {problem}
          </p>
        )}
      </div>

      <div className="flex w-[132px] shrink-0 flex-col gap-1.5">
        {rejected ? (
          confirming ? (
            <>
              <p className="m-0 text-[12px] font-semibold text-ds-red">
                Delete this post for good?
              </p>
              <Button
                type="button"
                variant="danger"
                className="w-full"
                disabled={busy}
                onClick={() => run(() => window.opencat.posts.delete(post.id))}
              >
                Delete
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setConfirming(false)}
              >
                Keep
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => editor.openPost(post)}
              >
                View
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full !text-ds-red"
                onClick={() => setConfirming(true)}
              >
                <Trash2 size={14} aria-hidden="true" />
                Delete
              </Button>
            </>
          )
        ) : (
          <>
            {late ? (
              <Button
                type="button"
                variant="primary"
                className="w-full"
                onClick={() => editor.openPost(post, { focus: 'time' })}
              >
                <CalendarClock size={14} aria-hidden="true" />
                Reschedule
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                className="w-full"
                disabled={busy}
                onClick={() => run(() => window.opencat.posts.approve(post.id))}
              >
                <Check size={14} aria-hidden="true" />
                Approve
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => editor.openPost(post)}
            >
              Edit
            </Button>
            {/* Nothing is lost: a rejected post moves to the Rejected tab until deleted. */}
            <Button
              type="button"
              variant="ghost"
              className="w-full !text-ds-red"
              disabled={busy}
              onClick={() => run(() => window.opencat.posts.reject(post.id))}
            >
              Reject
            </Button>
          </>
        )}
      </div>
    </article>
  )
}
