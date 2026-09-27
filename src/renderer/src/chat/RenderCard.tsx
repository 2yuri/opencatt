import { useContext, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Maximize2, Paperclip } from 'lucide-react'
import type { Post, PostMedia, RenderToolResult } from '@shared/api'
import { EditorContext } from '../editor/editorContext'
import { useMediaViewer, type ViewerItem } from '../media/viewerContext'
import { Button, Pill } from '../ui'
import { messageOf } from './useAgentChat'

const WHEN = (at: string): string => format(new Date(at), 'EEE d MMM · HH:mm')

/** The render as media, for seeding the editor. */
function asMedia(render: RenderToolResult): PostMedia {
  const video = render.durationMs !== undefined
  return {
    id: render.mediaId,
    kind: video ? 'video' : 'image',
    mime: video ? 'video/mp4' : 'image/png',
    bytes: render.bytes,
    width: render.width,
    height: render.height,
    durationMs: render.durationMs ?? null,
    alt: null,
    url: render.url
  }
}

interface Props {
  render: RenderToolResult
  onOpenPost?: (post: Post) => void
}

/** "0:15". */
function length(ms: number): string {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The render itself: a picture, or a video the agent recorded (OP-35) with its controls. */
function Visual({
  render,
  className,
  style
}: {
  render: RenderToolResult
  className: string
  style?: React.CSSProperties
}): React.JSX.Element {
  return render.durationMs !== undefined ? (
    <video src={render.url} className={className} style={style} controls muted playsInline />
  ) : (
    <img src={render.url} alt="" className={className} style={style} />
  )
}

/**
 * An image the agent rendered (OP-33), or a video it recorded (OP-35), with where it went: attached to a post, which opens, or
 * not yet, when it can start a new post. Save image… keeps a copy either way. Read live, so it
 * flips to attached when a later tool call attaches it.
 */
export function RenderCard({ render, onOpenPost }: Props): React.JSX.Element {
  const editor = useContext(EditorContext)
  // undefined while loading.
  const [post, setPost] = useState<Post | null | undefined>(undefined)
  const viewer = useMediaViewer()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const { posts } = window.opencat
    let live = true
    const load = (): void => {
      posts
        .withMedia(render.mediaId)
        .then((p) => live && setPost(p))
        .catch(() => live && setPost(null))
    }
    load()
    const stop = posts.onChanged(load)
    return () => {
      live = false
      stop()
    }
  }, [render.mediaId])

  const save = async (): Promise<void> => {
    setError(null)
    try {
      await window.opencat.media.saveAs(render.mediaId)
    } catch (err) {
      setError(messageOf(err))
    }
  }
  const status = post
    ? `Attached to the post for ${WHEN(post.scheduledAt)}`
    : post === null
      ? 'Not attached to a post yet'
      : ''
  const video = render.durationMs !== undefined
  const size = video
    ? `${render.width} × ${render.height} MP4 · ${length(render.durationMs!)}`
    : `${render.width} × ${render.height} PNG`
  const noun = video ? 'video' : 'image'

  // In the viewer the actions that leave it (to the editor, to the post) close it first.
  const actions = (leave: () => void = () => {}): React.JSX.Element => (
    <>
      {post ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            leave()
            onOpenPost?.(post)
          }}
        >
          Open post
        </Button>
      ) : (
        post === null &&
        editor && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => {
              leave()
              editor.openNew(undefined, { media: [asMedia(render)] })
            }}
          >
            Use in a new post
          </Button>
        )
      )}
      <Button type="button" variant="secondary" size="sm" onClick={() => void save()}>
        Save {noun}…
      </Button>
    </>
  )
  const enlarge = (): void => {
    const item: ViewerItem = {
      url: render.url,
      kind: video ? 'video' : 'image',
      width: render.width,
      height: render.height,
      sizeBytes: render.bytes,
      durationSec: render.durationMs !== undefined ? render.durationMs / 1000 : undefined
    }
    viewer.open([item], 0, { actions: actions(viewer.close) })
  }

  return (
    <article
      className="flex flex-col overflow-hidden rounded-[10px] border border-ds-border bg-ds-raised"
      aria-label={video ? 'Recorded video' : 'Rendered image'}
    >
      {/* A picture opens the viewer on click, as before; a video's clicks go to its controls. */}
      <div
        className={`relative bg-ds-inset ${video ? '' : 'cursor-zoom-in'}`}
        onClick={video ? undefined : enlarge}
      >
        <Visual
          render={render}
          className="block h-auto w-full"
          style={{ aspectRatio: `${render.width} / ${render.height}` }}
        />
        <button
          type="button"
          className={`absolute right-[10px] grid size-[28px] cursor-zoom-in ${video ? 'top-[10px]' : 'bottom-[10px]'} place-items-center rounded-full border-0 bg-black/60 p-0 text-white`}
          onClick={(e) => {
            e.stopPropagation()
            enlarge()
          }}
          aria-label={video ? 'View video' : 'View image'}
        >
          <Maximize2 size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-[8px] p-[12px]">
        {/* Status, then the post's pill and the size, as in the OP-33 frame. */}
        <p className="m-0 flex items-center gap-[6px] text-[11px] text-ds-text-3">
          {post && <Paperclip size={12} aria-hidden="true" />}
          {status}
        </p>
        <div className="flex items-center gap-[8px]">
          {post?.status === 'pending_approval' && (
            <Pill tone="pending">Waiting for your approval</Pill>
          )}
          <span className="font-mono text-[11px] text-ds-text-3">{size}</span>
        </div>
        <div className="flex flex-wrap items-center gap-[6px]">{actions()}</div>
        {error && (
          <p className="m-0 text-[12px] text-ds-red" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  )
}
