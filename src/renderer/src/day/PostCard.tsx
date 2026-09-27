import { useState } from 'react'
import { format } from 'date-fns'
import { ListOrdered, LoaderCircle } from 'lucide-react'
import type { Post, XAccount } from '@shared/api'
import { useEditor } from '../editor/editorContext'
import { ViewButton } from '../media/ViewButton'
import { useMediaViewer, viewerItemsForPost } from '../media/viewerContext'
import { postUrl } from './columns'
import { Button, buttonClass, Pill, type PillTone } from '../ui'
import { profileUrl, useReconnect, useXAccounts, type Reconnect } from './useReconnect'

export function PostCard({ post }: { post: Post }): React.JSX.Element {
  const editor = useEditor()
  const time = format(new Date(post.scheduledAt), 'HH:mm')
  const url = post.status === 'posted' ? postUrl(post) : null
  const postedAt = post.postedAt ? format(new Date(post.postedAt), 'HH:mm') : null

  const failed = post.status === 'failed'
  const needsAccount = failed && (post.errorCode === 'auth' || post.errorCode === 'uncertain')
  const accounts = useXAccounts(needsAccount && post.accountId !== null)
  const account = accounts.find((a) => a.id === post.accountId)
  const { reconnect, connect } = useReconnect(post, account)
  const reconnected = failed && reconnect.state === 'reconnected'
  const thumb = post.parts.some((part) => part.media.length > 0)
  return (
    <article
      className={`card-${post.status} flex min-w-0 flex-col gap-2 rounded-xl border bg-ds-raised p-3.5 ${failed ? 'border-ds-red/70' : 'border-ds-border'}`}
      data-testid="post-card"
    >
      {/* The thumbnail can't sit inside the edit button, so it lays over the button's second row
          through a subgrid, where the button leaves room for it (OP-88). */}
      <div
        className={`grid min-w-0 gap-y-2 ${thumb ? 'grid-cols-[minmax(0,1fr)_56px] gap-x-3' : 'grid-cols-[minmax(0,1fr)]'}`}
      >
        <button
          type="button"
          className="col-span-full row-span-2 row-start-1 grid w-full min-w-0 cursor-pointer grid-cols-subgrid grid-rows-subgrid border-0 bg-transparent p-0 text-left text-ds-text"
          onClick={() => editor.openPost(post)}
          aria-label={`${post.status === 'posted' || post.status === 'posting' ? 'View' : 'Edit'} post at ${time}`}
        >
          <span className="col-span-full row-start-1 flex w-full min-w-0 items-center gap-2">
            <time
              dateTime={post.scheduledAt}
              className="shrink-0 font-mono text-[14px] font-semibold"
            >
              {time}
            </time>
            {post.parts.length > 1 && (
              <span className="flex min-w-0 items-center gap-1 text-[11px] text-ds-text-3">
                <ListOrdered size={12} className="shrink-0" aria-hidden="true" />
                <span className="truncate">Thread of {post.parts.length}</span>
              </span>
            )}
            {post.status === 'posted' && postedAt && postedAt !== time && (
              <span className="min-w-0 truncate text-[11px] text-ds-text-3">posted {postedAt}</span>
            )}
            {post.status === 'scheduled' && post.nextAttemptAt && (
              // X couldn't take it yet; the time the user picked stays on the card (OP-69).
              <span className="text-[11px] text-ds-amber">
                Retrying at {format(new Date(post.nextAttemptAt), 'HH:mm')}
              </span>
            )}
            <span className="min-w-0 flex-1" />
            {post.status === 'posting' ? (
              <Pill tone="scheduled" role="status" className="shrink-0">
                Posting…
              </Pill>
            ) : reconnected ? (
              <Pill tone="scheduled">Reconnected</Pill>
            ) : (
              <Pill tone={PILL[post.status]} className="shrink-0">
                {STATUS[post.status]}
              </Pill>
            )}
          </span>
          <span className="col-start-1 row-start-2 min-w-0 text-[14px] leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere]">
            {post.text}
          </span>
        </button>
        {thumb && <CardThumb post={post} />}
      </div>
      {failed && post.errorCode === 'auth' && reconnect.state !== 'idle' ? (
        <ReconnectNote reconnect={reconnect} />
      ) : (
        failed &&
        post.error && (
          <p className="m-0 text-[12px] [overflow-wrap:anywhere] text-ds-red" role="alert">
            {post.error}
          </p>
        )
      )}
      {failed && (
        <FailedActions post={post} accounts={accounts} reconnect={reconnect} connect={connect} />
      )}
      {url && (
        // The main process opens https links in the system browser (setWindowOpenHandler).
        <a
          className="text-[12px] text-ds-accent-text no-underline"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          View on X ↗
        </a>
      )}
    </article>
  )
}

const STATUS: Record<Post['status'], string> = {
  pending_approval: 'Needs approval',
  rejected: 'Rejected',
  scheduled: 'Scheduled',
  posting: 'Posting',
  posted: 'Posted',
  failed: 'Failed'
}

const PILL: Record<Post['status'], PillTone> = {
  pending_approval: 'pending',
  rejected: 'failed',
  scheduled: 'scheduled',
  posting: 'scheduled',
  posted: 'posted',
  failed: 'failed'
}

/** The first media thumbnail, with a +N for the rest; it opens the viewer on all of them. */
function CardThumb({ post }: { post: Post }): React.JSX.Element | null {
  const viewer = useMediaViewer()
  const thumb = post.parts.flatMap((part) => part.media)[0]
  const mediaCount = post.parts.reduce((n, part) => n + part.media.length, 0)
  if (!thumb) return null
  return (
    <ViewButton
      kind={thumb.kind}
      onOpen={() => viewer.open(viewerItemsForPost(post), 0)}
      className="relative col-start-2 row-start-2 size-14 shrink-0 overflow-hidden rounded-lg"
      data-testid="card-thumb"
    >
      {thumb.kind === 'video' ? (
        <video
          src={thumb.url}
          preload="metadata"
          muted
          aria-hidden="true"
          className="block size-full object-cover"
        />
      ) : (
        <img src={thumb.url} alt="" className="block size-full object-cover" />
      )}
      {mediaCount > 1 && (
        <span className="absolute right-1 bottom-1 rounded bg-black/65 px-1 text-[10px] font-bold text-white">
          +{mediaCount - 1}
        </span>
      )}
    </ViewButton>
  )
}

/** What an auth-failed card says while it reconnects, in place of the error (design OP-27). */
function ReconnectNote({ reconnect }: { reconnect: Reconnect }): React.JSX.Element {
  if (reconnect.state === 'connecting') {
    return (
      <p className="m-0 text-[12px] text-ds-text-2" role="status">
        Finish signing in to X in your browser…
      </p>
    )
  }
  if (reconnect.state === 'reconnected') {
    return (
      <p className="m-0 text-[12px] text-ds-green" role="status">
        Connected as @{reconnect.handle}. Nothing is resent on its own.
      </p>
    )
  }
  return (
    <p className="m-0 text-[12px] [overflow-wrap:anywhere] text-ds-red" role="alert">
      {reconnect.state === 'error' ? reconnect.message : null}
    </p>
  )
}

/**
 * What a failed post offers depends on why it failed. `auth` gets Reconnect X (auth.connect), and
 * once reconnected the same Post now and Reschedule as any other failure; nothing resends by itself.
 */
function FailedActions({
  post,
  accounts,
  reconnect,
  connect
}: {
  post: Post
  accounts: XAccount[]
  reconnect: Reconnect
  connect: () => void
}): React.JSX.Element {
  const editor = useEditor()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const code = post.errorCode
  const signedOut = code === 'auth' && reconnect.state !== 'reconnected'
  const canPostNow = code !== 'rejected' && !signedOut

  function postNow(): void {
    if (code === 'uncertain' && !confirming) return setConfirming(true)
    setBusy(true)
    setProblem(null)
    window.opencat.posts
      .update(post.id, { scheduledAt: new Date().toISOString() })
      .catch((err: unknown) => {
        setProblem(String(err))
        setBusy(false)
      })
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="m-0 w-full text-[12px] text-ds-text-2">
          This may already be on X. Post it again?
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Cancel
        </Button>
        <Button type="button" variant="danger" size="sm" disabled={busy} onClick={postNow}>
          Post anyway
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {code === 'uncertain' && post.accountId && (
        <CheckOnX accountId={post.accountId} accounts={accounts} />
      )}
      {signedOut ? (
        reconnect.state === 'connecting' ? (
          <>
            <Button type="button" variant="secondary" size="sm" disabled>
              <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
              Connecting…
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={connect}>
              Open X again
            </Button>
          </>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={connect}>
            {reconnect.state === 'error' ? 'Try again' : 'Reconnect X'}
          </Button>
        )
      ) : canPostNow ? (
        <>
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={postNow}>
            Post now
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => editor.openPost(post, { focus: 'time' })}
          >
            Reschedule
          </Button>
        </>
      ) : (
        <Button type="button" variant="secondary" size="sm" onClick={() => editor.openPost(post)}>
          Edit
        </Button>
      )}
      {problem && (
        <p className="m-0 w-full text-[12px] text-ds-red" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}

/** Opens the account's profile, by handle once auth.status knows it. */
function CheckOnX({
  accountId,
  accounts
}: {
  accountId: string
  accounts: XAccount[]
}): React.JSX.Element {
  return (
    // The main process opens https links in the system browser (setWindowOpenHandler).
    <a
      className={buttonClass('ghost', 'sm', 'text-ds-accent-text no-underline')}
      href={profileUrl(accountId, accounts)}
      target="_blank"
      rel="noreferrer"
    >
      Check on X
    </a>
  )
}
