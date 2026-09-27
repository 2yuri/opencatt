import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { CalendarClock, Check, Film, ListOrdered } from 'lucide-react'
import { MISSED_AFTER_MS, type Post, type PostsToolResult } from '@shared/api'
import { ViewButton } from '../media/ViewButton'
import { useMediaViewer, viewerItemsForPost } from '../media/viewerContext'
import { messageOf } from './useAgentChat'
import { Button, Pill, type PillTone } from '../ui'

/** "Tue 29 Sep · 09:00", as on the day board and in the design (24-hour time). */
const WHEN = { format: (at: Date): string => format(at, 'EEE d MMM · HH:mm') }

const STATUS: Record<Post['status'], string> = {
  pending_approval: 'Waiting for your approval',
  rejected: 'Rejected',
  scheduled: 'Scheduled',
  posting: 'Posting',
  posted: 'Posted',
  failed: 'Failed'
}

const CARD =
  'flex flex-col gap-2.5 rounded-[10px] border border-ds-border bg-ds-raised p-3 [&.pending_approval]:border-ds-amber/45'

const PILL: Record<Post['status'], PillTone> = {
  pending_approval: 'pending',
  rejected: 'failed',
  scheduled: 'scheduled',
  posting: 'scheduled',
  posted: 'posted',
  failed: 'failed'
}

/** "5 images", "1 video", "1 GIF": what a post carries, or null when nothing. */
function mediaCount(media: Post['parts'][number]['media']): string | null {
  if (media.length === 0) return null
  const count = (kind: string, one: string, many: string): string | null => {
    const n = media.filter((m) => m.kind === kind).length
    return n === 0 ? null : `${n} ${n === 1 ? one : many}`
  }
  return [
    count('image', 'image', 'images'),
    count('gif', 'GIF', 'GIFs'),
    count('video', 'video', 'videos')
  ]
    .filter(Boolean)
    .join(', ')
}

/** A value for <input type="datetime-local">, in local time. */
function localInput(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  )
}

interface Props {
  postId: string
  action: PostsToolResult['action']
  onOpen?: (post: Post) => void
  now?: () => Date
}

/**
 * A post the agent touched, read live so it shows the post as it is now. A post waiting for
 * approval can be approved right here; one whose time has passed is approved at a new time.
 */
export function PostCard({
  postId,
  action,
  onOpen,
  now = () => new Date()
}: Props): React.JSX.Element {
  // undefined while loading, null once we know it is gone.
  const [post, setPost] = useState<Post | null | undefined>(action === 'deleted' ? null : undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newTime, setNewTime] = useState<string | null>(null)
  const viewer = useMediaViewer()

  useEffect(() => {
    if (action === 'deleted') return
    const { posts } = window.opencat
    let live = true
    const load = (): void => {
      posts
        .get(postId)
        .then((p) => live && setPost(p))
        .catch(() => live && setPost(null))
    }
    load()
    const stop = posts.onChanged((event) => {
      if (event.ids.includes(postId)) load()
    })
    return () => {
      live = false
      stop()
    }
  }, [postId, action])

  if (post === undefined) {
    return <div className={`${CARD} text-[12px] text-ds-text-3`}>Loading post…</div>
  }
  if (post === null) {
    return (
      <div className={`${CARD} text-[12px] text-ds-text-3`}>
        {action === 'deleted' ? 'Deleted a post.' : 'This post was deleted.'}
      </div>
    )
  }

  const at = new Date(post.scheduledAt)
  const pending = post.status === 'pending_approval'
  const timePassed = pending && at.getTime() < now().getTime() - MISSED_AFTER_MS
  const media = post.parts.flatMap((part) => part.media)
  // The first file, a video included: X never mixes a video with other media in one part.
  const thumb = media[0] ?? null
  // "Thread of 5 · 5 images", per Pencil "OP-21 v2 · Attachments in chat".
  const meta = [post.parts.length > 1 ? `Thread of ${post.parts.length}` : null, mediaCount(media)]
    .filter(Boolean)
    .join(' · ')

  const approve = async (scheduledAt?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      // The card reloads through posts:changed.
      await window.opencat.posts.approve(post.id, scheduledAt)
      setNewTime(null)
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const state = timePassed ? 'time-passed' : post.status
  return (
    <article
      className={`${CARD} post-card ${state}`}
      data-state={state}
      aria-label={`Post for ${WHEN.format(at)}`}
    >
      <div className="flex gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* The date stays on one line; when the row is too narrow the pill drops below it. */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] tracking-[0.3px] whitespace-nowrap text-ds-text-3 uppercase">
              {WHEN.format(at)}
            </span>
            <span className="flex-1" />
            <Pill tone={timePassed ? 'neutral' : PILL[post.status]}>
              {timePassed ? 'Time passed' : STATUS[post.status]}
            </Pill>
          </div>
          <p
            className={`m-0 text-[13px] leading-[1.5] [overflow-wrap:anywhere] ${post.status === 'rejected' ? 'text-ds-text-3 line-through' : ''}`}
          >
            {post.text}
          </p>
          {meta && (
            <span className="flex items-center gap-[6px] text-[11px] text-ds-text-3">
              {post.parts.length > 1 && <ListOrdered size={12} aria-hidden="true" />}
              {meta}
            </span>
          )}
          {timePassed && (
            <p className="m-0 text-[12px] text-ds-amber">Time passed: reschedule to approve</p>
          )}
          {post.status === 'failed' && post.error && (
            <p className="m-0 text-[12px] text-ds-red">{post.error}</p>
          )}
        </div>
        {thumb && (
          <ViewButton
            kind={thumb.kind}
            onOpen={() => viewer.open(viewerItemsForPost(post), 0)}
            className="relative size-[52px] shrink-0 overflow-hidden rounded-lg"
          >
            {thumb.kind === 'video' ? (
              <>
                {/* The first frame as a poster: metadata only, never played here. */}
                <video
                  src={`${thumb.url}#t=0.1`}
                  className="block size-full object-cover"
                  preload="metadata"
                  muted
                  playsInline
                  aria-hidden="true"
                />
                <span className="absolute bottom-[3px] left-[3px] grid size-[16px] place-items-center rounded-[4px] bg-[#000000A0] text-white">
                  <Film size={10} aria-hidden="true" />
                </span>
              </>
            ) : (
              <img src={thumb.url} alt={thumb.alt ?? ''} className="block size-full object-cover" />
            )}
            {media.length > 1 && (
              <span className="absolute right-[3px] bottom-[3px] flex h-[16px] items-center rounded-[4px] bg-[#000000A0] px-[4px] text-[10px] font-semibold text-white">
                +{media.length - 1}
              </span>
            )}
          </ViewButton>
        )}
      </div>

      {newTime !== null ? (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            void approve(new Date(newTime).toISOString())
          }}
        >
          <input
            type="datetime-local"
            className="h-7 rounded-md border border-ds-border-strong bg-ds-inset px-2 text-[12px] text-ds-text [color-scheme:dark]"
            aria-label="New time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            required
          />
          <Button type="submit" variant="primary" size="sm" disabled={busy || !newTime}>
            Approve at this time
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setNewTime(null)}
            disabled={busy}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-1">
          {pending && !timePassed && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => void approve()}
            >
              <Check size={13} aria-hidden="true" />
              Approve
            </Button>
          )}
          {timePassed && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => setNewTime(localInput(new Date(now().getTime() + 60 * 60 * 1000)))}
            >
              <CalendarClock size={13} aria-hidden="true" />
              Reschedule
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpen?.(post)}>
            {pending || post.status === 'rejected' ? 'Open in Approvals' : 'Open day'}
          </Button>
        </div>
      )}
      {error && (
        <p className="m-0 text-[12px] text-ds-red" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}
