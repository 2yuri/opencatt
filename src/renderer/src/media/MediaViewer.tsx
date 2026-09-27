import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Pause,
  Play,
  Repeat,
  Volume2,
  VolumeX,
  X
} from 'lucide-react'
import {
  MediaViewerContext,
  type MediaViewerApi,
  type ViewerItem,
  type ViewerOptions
} from './viewerContext'

interface Open {
  key: number
  items: ViewerItem[]
  index: number
  actions?: ReactNode
}

/** Holds the app's one media viewer (OP-88), so any thumbnail on any screen can open it. */
export function MediaViewerProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState<Open | null>(null)
  const close = useCallback(() => setOpen(null), [])
  const api = useMemo<MediaViewerApi>(
    () => ({
      open: (items: ViewerItem[], startIndex: number, options?: ViewerOptions) => {
        if (items.length === 0) return
        const index = Math.min(Math.max(0, startIndex), items.length - 1)
        setOpen({ key: Date.now(), items, index, actions: options?.actions })
      },
      close: () => setOpen(null)
    }),
    []
  )
  return (
    <MediaViewerContext.Provider value={api}>
      {children}
      {open && (
        <MediaViewer
          key={open.key}
          items={open.items}
          startIndex={open.index}
          actions={open.actions}
          onClose={close}
        />
      )}
    </MediaViewerContext.Provider>
  )
}

// Pencil "OP-88 · Viewer": at 1440×900 the media box is 1000×562 at 70px from the top, with the
// info bar 20px under it. Smaller windows keep 220px each side and 268px below.
const BOX_W = 'min(1000px, calc(100vw - 440px))'
const BOX_H = 'max(200px, calc(100vh - 338px))'

/** What the file itself says, once loaded, for what the item didn't know. */
interface Measured {
  width?: number
  height?: number
  durationSec?: number
}

interface ViewerProps {
  items: ViewerItem[]
  startIndex: number
  actions?: ReactNode
  onClose: () => void
}

/**
 * Full-size media over the whole window: ← → between the files, Esc or a click on the backdrop
 * closes, and focus goes back to the thumbnail that opened it.
 */
export function MediaViewer({
  items,
  startIndex,
  actions,
  onClose
}: ViewerProps): React.JSX.Element {
  const [index, setIndex] = useState(startIndex)
  const [measured, setMeasured] = useState<Record<string, Measured>>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const videoRef = useRef<VideoHandle | null>(null)
  const onVideo = useCallback((handle: VideoHandle | null) => {
    videoRef.current = handle
  }, [])

  const item = items[index]!
  const many = items.length > 1
  const known: Measured = { ...measured[item.url] }
  const width = item.width ?? known.width
  const height = item.height ?? known.height
  const durationSec = item.durationSec ?? known.durationSec
  const image = item.kind !== 'video' && !item.converting

  // Close is focused on open; on close, focus goes back to whatever opened the viewer.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    return () => opener?.focus?.()
  }, [])

  // A Prev or Next that just went disabled drops focus to the body, where the day board's own
  // arrow keys would take over: keep it in the viewer.
  useEffect(() => {
    const root = rootRef.current
    if (root && !root.contains(document.activeElement)) root.focus()
  }, [index])

  const measure = useCallback((url: string, found: Measured) => {
    setMeasured((current) => ({ ...current, [url]: { ...current[url], ...found } }))
  }, [])

  // At 100% the image fills the window, so the controls get a dark ground to stay legible.
  const [zoomed, setZoomed] = useState(false)

  const go = (step: -1 | 1): void => {
    setZoomed(false)
    setIndex((i) => Math.min(Math.max(0, i + step), items.length - 1))
  }

  function onKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'Escape') onClose()
    else if (event.key === 'ArrowLeft') go(-1)
    else if (event.key === 'ArrowRight') go(1)
    else if (event.key === ' ' && item.kind === 'video' && !item.converting)
      videoRef.current?.toggle()
    else if (event.key === 'Tab') trapFocus(event, rootRef.current)
    else return
    event.preventDefault()
    // Nothing under the viewer (the editor's Esc, the day board's arrows) gets these keys.
    event.stopPropagation()
  }

  function onClick(event: React.MouseEvent): void {
    if ((event.target as HTMLElement).dataset.backdrop !== undefined) onClose()
  }

  const meta = [
    item.partLabel,
    width && height ? `${width} × ${height}` : null,
    item.kind === 'video' && durationSec !== undefined ? clock(durationSec) : null,
    item.sizeBytes ? fileSize(item.sizeBytes) : null
  ]
    .filter(Boolean)
    .join(' · ')

  return createPortal(
    // The root takes focus (tabIndex -1) when a click lands on the media, so keys stay here.
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] flex flex-col items-center bg-[#050507]/93 pt-[70px] text-white outline-none"
      role="dialog"
      aria-modal="true"
      aria-label="Media viewer"
      tabIndex={-1}
      data-backdrop=""
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      <div
        className="relative flex shrink-0 items-center justify-center"
        style={{ width: BOX_W, height: BOX_H }}
        data-backdrop=""
      >
        {item.converting ? (
          <Converting fraction={item.converting.fraction} />
        ) : item.kind === 'video' ? (
          <VideoPlayer
            key={index}
            item={item}
            onHandle={onVideo}
            onMeta={(found) => measure(item.url, found)}
          />
        ) : (
          <ZoomableImage
            key={index}
            item={item}
            zoomed={zoomed}
            onZoom={setZoomed}
            onMeta={(found) => measure(item.url, found)}
          />
        )}
        {many && (
          <>
            <button
              type="button"
              className={`${ROUND} ${zoomed ? 'bg-black/70' : 'bg-white/10'} right-[calc(100%+30px)]`}
              disabled={index === 0}
              onClick={() => go(-1)}
              aria-label="Previous"
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`${ROUND} ${zoomed ? 'bg-black/70' : 'bg-white/10'} left-[calc(100%+30px)]`}
              disabled={index === items.length - 1}
              onClick={() => go(1)}
              aria-label="Next"
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div
        className={`relative z-[2] mt-[20px] box-content flex h-[40px] shrink-0 items-center gap-[14px] ${zoomed ? '-mx-[12px] rounded-[10px] bg-black/75 px-[12px]' : ''}`}
        style={{ width: BOX_W }}
      >
        {many && (
          <span
            className="flex h-[24px] shrink-0 items-center rounded-[12px] bg-white/10 px-[10px] font-mono text-[11px] whitespace-nowrap"
            data-testid="viewer-counter"
          >
            {index + 1} / {items.length}
          </span>
        )}
        <span className="min-w-0 truncate text-[13px] font-medium">
          {item.name ?? nameOf(item)}
        </span>
        {meta && (
          <span className="shrink-0 font-mono text-[11px] whitespace-nowrap text-white/65">
            {meta}
          </span>
        )}
        <span className="min-w-0 flex-1" />
        {image && (
          <span className="shrink-0 text-[12px] whitespace-nowrap text-white/50">
            {zoomed ? 'Click to fit' : 'Click to zoom to 100%'}
          </span>
        )}
        {actions && <span className="flex shrink-0 items-center gap-[6px]">{actions}</span>}
        <button
          ref={closeRef}
          type="button"
          className="flex h-[30px] shrink-0 cursor-pointer items-center gap-[6px] rounded-[8px] border border-white/20 bg-transparent px-[10px] text-white hover:bg-white/10"
          onClick={onClose}
        >
          <X size={13} aria-hidden="true" />
          <span className="text-[12px] font-medium">Close</span>
          <kbd className="font-mono text-[10px] text-white/50">Esc</kbd>
        </button>
      </div>
    </div>,
    document.body
  )
}

const ROUND =
  'absolute top-1/2 z-[2] grid size-[40px] -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 p-0 text-white hover:bg-white/20 disabled:cursor-default disabled:opacity-30'

/**
 * An image or GIF, fit to the box. A click shows it at 100% over the whole window, where it pans
 * by dragging when it is larger than the window; another click fits it again.
 */
function ZoomableImage({
  item,
  zoomed,
  onZoom,
  onMeta
}: {
  item: ViewerItem
  zoomed: boolean
  onZoom: (zoomed: boolean) => void
  onMeta: (found: Measured) => void
}): React.JSX.Element {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  // Set while the image is panned, so the click that ends the drag doesn't zoom out or close.
  const dragged = useRef(false)

  const pannable =
    natural !== null && (natural.w > window.innerWidth || natural.h > window.innerHeight)
  const clamp = (x: number, y: number): { x: number; y: number } => {
    if (!natural) return { x: 0, y: 0 }
    const maxX = Math.max(0, (natural.w - window.innerWidth) / 2)
    const maxY = Math.max(0, (natural.h - window.innerHeight) / 2)
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) }
  }

  const toggle = (event: React.MouseEvent): void => {
    event.stopPropagation()
    if (dragged.current) {
      dragged.current = false
      return
    }
    onZoom(!zoomed)
    setOffset({ x: 0, y: 0 })
  }

  const img = (
    <img
      src={item.url}
      alt={item.alt ?? ''}
      draggable={false}
      data-zoom={zoomed ? '100' : 'fit'}
      className={
        zoomed
          ? `max-w-none shrink-0 select-none ${pannable ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-out'}`
          : 'block cursor-zoom-in rounded-[6px] object-contain select-none'
      }
      style={
        zoomed
          ? {
              width: natural?.w,
              height: natural?.h,
              transform: `translate(${offset.x}px, ${offset.y}px)`
            }
          : { maxWidth: BOX_W, maxHeight: BOX_H }
      }
      onLoad={(e) => {
        const { naturalWidth: w, naturalHeight: h } = e.currentTarget
        if (w && h) {
          setNatural({ w, h })
          onMeta({ width: w, height: h })
        }
      }}
      onClick={toggle}
      onPointerDown={(e) => {
        if (!zoomed || !pannable) return
        dragged.current = false
        drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId)
        } catch {
          // A pointer the browser no longer knows; the drag still follows moves over the image.
        }
      }}
      onPointerMove={(e) => {
        const start = drag.current
        if (!start) return
        const dx = e.clientX - start.x
        const dy = e.clientY - start.y
        if (Math.abs(dx) + Math.abs(dy) > 3) dragged.current = true
        setOffset(clamp(start.ox + dx, start.oy + dy))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
    />
  )

  if (!zoomed) return img
  // At 100% the image leaves the box and takes the window, under the arrows and the info bar.
  return (
    <div
      className="fixed inset-0 z-[1] flex items-center justify-center overflow-hidden"
      data-backdrop=""
      onClick={(e) => {
        if (!dragged.current) return
        dragged.current = false
        e.stopPropagation()
      }}
    >
      {img}
    </div>
  )
}

interface VideoHandle {
  toggle(): void
}

/** A video with the viewer's own controls over its bottom edge. Muted, playing, not looping. */
function VideoPlayer({
  item,
  onHandle,
  onMeta
}: {
  item: ViewerItem
  onHandle: (handle: VideoHandle | null) => void
  onMeta: (found: Measured) => void
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const [loop, setLoop] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(item.durationSec ?? 0)

  const toggle = useCallback((): void => {
    const video = ref.current
    if (!video) return
    if (video.paused) {
      // play() rejects when the file can't play; the button just stays on Play.
      void Promise.resolve(video.play()).catch(() => setPlaying(false))
      setPlaying(true)
    } else {
      video.pause()
      setPlaying(false)
    }
  }, [])

  // Space in the viewer plays and pauses.
  useEffect(() => {
    onHandle({ toggle })
    return () => onHandle(null)
  }, [onHandle, toggle])

  const seek = (seconds: number): void => {
    const video = ref.current
    if (!video || !duration) return
    const to = Math.min(duration, Math.max(0, seconds))
    video.currentTime = to
    setTime(to)
  }

  const fromPointer = (event: React.PointerEvent<HTMLElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    if (box.width > 0) seek(((event.clientX - box.left) / box.width) * duration)
  }

  const fraction = duration ? Math.min(1, time / duration) : 0

  return (
    <div className="relative overflow-hidden rounded-[6px] bg-black">
      <video
        ref={ref}
        src={item.url}
        className="block cursor-pointer"
        style={{ maxWidth: BOX_W, maxHeight: BOX_H }}
        autoPlay
        muted={muted}
        loop={loop}
        playsInline
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          if (Number.isFinite(v.duration)) setDuration(v.duration)
          onMeta({
            width: v.videoWidth || undefined,
            height: v.videoHeight || undefined,
            durationSec: Number.isFinite(v.duration) ? v.duration : undefined
          })
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 flex h-[44px] items-center gap-[12px] bg-black/60 px-[14px]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={ICON}
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
        </button>
        <span className="font-mono text-[11px]">{clock(time)}</span>
        <div
          className="group flex h-[20px] min-w-0 flex-1 cursor-pointer items-center outline-none"
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${clock(time)} of ${clock(duration)}`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId)
            fromPointer(e)
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) fromPointer(e)
          }}
          onKeyDown={(e) => {
            const to =
              e.key === 'ArrowLeft' || e.key === 'ArrowDown'
                ? time - 5
                : e.key === 'ArrowRight' || e.key === 'ArrowUp'
                  ? time + 5
                  : e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? duration
                      : null
            if (to === null) return
            e.preventDefault()
            // The arrows seek here instead of moving to another file.
            e.stopPropagation()
            seek(to)
          }}
        >
          <span className="relative h-[4px] w-full rounded-[2px] bg-white/25 group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-4 group-focus-visible:outline-ds-accent">
            <span
              className="absolute inset-y-0 left-0 rounded-[2px] bg-ds-accent"
              style={{ width: `${fraction * 100}%` }}
              data-testid="viewer-scrub-fill"
            />
          </span>
        </div>
        <span className="font-mono text-[11px] text-white/70">{clock(duration)}</span>
        <button
          type="button"
          className={`${ICON} ${loop ? 'text-ds-accent-text' : ''}`}
          onClick={() => setLoop((l) => !l)}
          aria-label="Loop"
          aria-pressed={loop}
        >
          <Repeat size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={ICON}
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? (
            <VolumeX size={16} aria-hidden="true" />
          ) : (
            <Volume2 size={16} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  )
}

const ICON =
  'grid size-[24px] shrink-0 cursor-pointer place-items-center rounded-[6px] border-0 bg-transparent p-0 text-white hover:bg-white/10'

/** A video still converting for X: the progress in place of the file. */
function Converting({ fraction }: { fraction: number }): React.JSX.Element {
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
  return (
    <div
      className="grid size-full place-items-center rounded-[6px] border border-ds-border bg-ds-inset"
      data-testid="viewer-converting"
    >
      <div
        className="box-border flex w-[400px] max-w-[calc(100%-32px)] flex-col gap-[10px] rounded-[12px] border border-ds-border-strong bg-ds-surface px-[18px] py-[16px]"
        role="status"
      >
        <div className="flex items-center gap-[8px]">
          <LoaderCircle size={14} className="animate-spin text-ds-accent-text" aria-hidden="true" />
          <span className="text-[13px] font-medium text-ds-text">Converting for X</span>
          <span className="flex-1" />
          <span className="font-mono text-[11px] text-ds-text-2">{percent}%</span>
        </div>
        <div className="relative h-[4px] rounded-[2px] bg-ds-border">
          <div
            className="absolute inset-y-0 left-0 rounded-[2px] bg-ds-accent"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="m-0 text-[12px] text-ds-text-3">It can be viewed once it&apos;s ready.</p>
      </div>
    </div>
  )
}

/** Tab and Shift+Tab go round the viewer's own controls. */
function trapFocus(event: React.KeyboardEvent, root: HTMLElement | null): void {
  if (!root) return
  const focusable = Array.from(
    root.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"], a[href], input')
  )
  if (focusable.length === 0) return
  const at = focusable.indexOf(document.activeElement as HTMLElement)
  const next = event.shiftKey
    ? at <= 0
      ? focusable.length - 1
      : at - 1
    : at === -1 || at === focusable.length - 1
      ? 0
      : at + 1
  focusable[next]!.focus()
}

/** "0:07", "1:05". */
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "184 KB", "3.2 MB", "41 MB". */
function fileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 10) return `${Math.round(mb)} MB`
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * What to call the file. Posts don't keep the original file name, and the media store names files
 * by id, so a stored file is labelled by its kind rather than showing a UUID.
 */
function nameOf(item: ViewerItem): string {
  const path = item.url.split(/[?#]/)[0] ?? item.url
  let last = path.split('/').pop() || path
  try {
    last = decodeURIComponent(last)
  } catch {
    // Keep the raw segment.
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./i.test(last)) return last
  return item.kind === 'video' ? 'Video' : item.kind === 'gif' ? 'GIF' : 'Image'
}
