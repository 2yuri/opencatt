import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MediaViewerProvider } from './MediaViewer'
import { useMediaViewer, viewerItemsForPost, type ViewerItem } from './viewerContext'
import { makePost } from '../day/testPosts'

const IMAGES: ViewerItem[] = [
  { url: 'opencat-media://media/a.png', kind: 'image', partLabel: 'Part 1', sizeBytes: 188_416 },
  {
    url: 'opencat-media://media/launch-quote.png',
    kind: 'image',
    name: 'launch-quote.png',
    partLabel: 'Part 1',
    width: 1200,
    height: 675,
    sizeBytes: 184 * 1024
  },
  { url: 'opencat-media://media/c.gif', kind: 'gif', partLabel: 'Part 2' }
]

const VIDEO: ViewerItem = {
  url: 'opencat-media://media/teaser.mp4',
  kind: 'video',
  width: 1280,
  height: 720,
  durationSec: 15,
  sizeBytes: 3.2 * 1024 * 1024
}

/** A thumbnail per item, as a card would have, that opens the viewer at it. */
function Thumbs({
  items,
  actions
}: {
  items: ViewerItem[]
  actions?: React.ReactNode
}): React.JSX.Element {
  const viewer = useMediaViewer()
  return (
    <>
      {items.map((_, i) => (
        <button key={i} type="button" onClick={() => viewer.open(items, i, { actions })}>
          thumb {i + 1}
        </button>
      ))}
    </>
  )
}

function show(items: ViewerItem[], actions?: React.ReactNode): void {
  render(
    <MediaViewerProvider>
      <Thumbs items={items} actions={actions} />
    </MediaViewerProvider>
  )
}

/** Clicks a thumbnail the way a user does: focus lands on it first. */
function openAt(n: number): HTMLElement {
  const thumb = screen.getByRole('button', { name: `thumb ${n}` })
  thumb.focus()
  fireEvent.click(thumb)
  return screen.getByRole('dialog', { name: 'Media viewer' })
}

const counter = (): string => screen.getByTestId('viewer-counter').textContent ?? ''
const key = (k: string): void => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: k })
}

let play: ReturnType<typeof vi.fn<(this: HTMLMediaElement) => Promise<void>>>
let pause: ReturnType<typeof vi.fn<(this: HTMLMediaElement) => void>>

beforeEach(() => {
  // jsdom has no media playback: play and pause flip `paused` and fire the events a browser would.
  let paused = true
  play = vi.fn<(this: HTMLMediaElement) => Promise<void>>(function (this: HTMLMediaElement) {
    paused = false
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  pause = vi.fn<(this: HTMLMediaElement) => void>(function (this: HTMLMediaElement) {
    paused = true
    this.dispatchEvent(new Event('pause'))
  })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause)
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MediaViewer', () => {
  it('opens at the clicked thumbnail, with its counter, name and what is known about it', () => {
    show(IMAGES)
    const dialog = openAt(2)
    expect(counter()).toBe('2 / 3')
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(IMAGES[1]!.url)
    expect(dialog.textContent).toContain('launch-quote.png')
    expect(dialog.textContent).toContain('Part 1 · 1200 × 675 · 184 KB')
    expect(dialog.textContent).toContain('Click to zoom to 100%')
    // Close takes focus, and Esc is shown on it.
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: /Close/ }))
  })

  it("names a file by its URL when it has no name, and leaves out what isn't known", () => {
    show(IMAGES)
    const dialog = openAt(3)
    expect(dialog.textContent).toContain('c.gif')
    const meta = within(dialog).getByText('Part 2')
    expect(meta.textContent).toBe('Part 2')
  })

  it('fills in the size from the loaded image', () => {
    show(IMAGES)
    const dialog = openAt(1)
    const img = dialog.querySelector('img')!
    Object.defineProperty(img, 'naturalWidth', { value: 800 })
    Object.defineProperty(img, 'naturalHeight', { value: 600 })
    fireEvent.load(img)
    expect(dialog.textContent).toContain('Part 1 · 800 × 600 · 184 KB')
  })

  it('moves with ← → and the buttons, and stops at the ends', () => {
    show(IMAGES)
    openAt(1)
    const prev = screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement
    const next = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement
    expect(prev.disabled).toBe(true)
    key('ArrowLeft')
    expect(counter()).toBe('1 / 3')

    key('ArrowRight')
    expect(counter()).toBe('2 / 3')
    fireEvent.click(next)
    expect(counter()).toBe('3 / 3')
    expect(next.disabled).toBe(true)
    key('ArrowRight')
    expect(counter()).toBe('3 / 3')

    fireEvent.click(prev)
    expect(counter()).toBe('2 / 3')
    expect(prev.disabled).toBe(false)
  })

  it('keeps its keys from the screen under it', () => {
    const onKey = vi.fn()
    window.addEventListener('keydown', onKey)
    show(IMAGES)
    openAt(1)
    key('ArrowRight')
    key('Escape')
    window.removeEventListener('keydown', onKey)
    expect(onKey).not.toHaveBeenCalled()
  })

  it('has no arrows or counter for a single file', () => {
    show([VIDEO])
    openAt(1)
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(screen.queryByTestId('viewer-counter')).toBeNull()
  })

  it('closes on Esc and gives focus back to the thumbnail', () => {
    show(IMAGES)
    openAt(2)
    key('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'thumb 2' }))
  })

  it('closes on a click on the backdrop or on Close, not on the media', () => {
    show(IMAGES)
    let dialog = openAt(1)
    fireEvent.click(dialog.querySelector('img')!)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByTestId('viewer-counter'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(dialog)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'thumb 1' }))

    dialog = openAt(3)
    fireEvent.click(within(dialog).getByRole('button', { name: /Close/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'thumb 3' }))
  })

  it('zooms an image to 100% on click, and fits it again on the next', () => {
    show(IMAGES)
    const dialog = openAt(2)
    const img = (): HTMLImageElement => dialog.querySelector('img')!
    expect(img().dataset.zoom).toBe('fit')
    expect(img().className).toContain('cursor-zoom-in')
    fireEvent.click(img())
    expect(img().dataset.zoom).toBe('100')
    expect(dialog.textContent).toContain('Click to fit')
    fireEvent.click(img())
    expect(img().dataset.zoom).toBe('fit')
    // Another file starts fitted.
    fireEvent.click(img())
    key('ArrowRight')
    expect(img().dataset.zoom).toBe('fit')
  })

  it('keeps Tab inside the viewer', () => {
    show(IMAGES)
    openAt(2)
    const close = screen.getByRole('button', { name: /Close/ })
    expect(document.activeElement).toBe(close)
    key('Tab')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Previous' }))
  })

  it('shows the actions it was given before Close', () => {
    const onUse = vi.fn()
    show(
      [IMAGES[0]!],
      <button type="button" onClick={onUse}>
        Use in a new post
      </button>
    )
    const dialog = openAt(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use in a new post' }))
    expect(onUse).toHaveBeenCalled()
  })
})

describe('MediaViewer video', () => {
  it('plays muted, not looping, with its own controls', () => {
    show([IMAGES[0]!, VIDEO])
    const dialog = openAt(2)
    const video = dialog.querySelector('video')!
    expect(video.getAttribute('src')).toBe(VIDEO.url)
    expect(video.muted).toBe(true)
    expect(video.loop).toBe(false)
    expect(video.autoplay).toBe(true)
    expect(dialog.textContent).toContain('1280 × 720 · 0:15 · 3.2 MB')
    expect(dialog.textContent).not.toContain('Click to zoom')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Play' }))
    expect(play).toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause' }))
    expect(pause).toHaveBeenCalled()
    expect(within(dialog).getByRole('button', { name: 'Play' })).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Unmute' }))
    expect(video.muted).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mute' }))
    expect(video.muted).toBe(true)

    const loop = within(dialog).getByRole('button', { name: 'Loop' })
    expect(loop.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(loop)
    expect(loop.getAttribute('aria-pressed')).toBe('true')
    expect(loop.className).toContain('text-ds-accent-text')
    expect(video.loop).toBe(true)
  })

  it('plays and pauses on Space', () => {
    show([VIDEO])
    const dialog = openAt(1)
    key(' ')
    expect(play).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('button', { name: 'Pause' })).toBeTruthy()
    key(' ')
    expect(pause).toHaveBeenCalledTimes(1)
    // Space didn't press the focused Close.
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('seeks with the scrub bar from the keyboard, without leaving the file', () => {
    show([IMAGES[0]!, VIDEO])
    const dialog = openAt(2)
    const video = dialog.querySelector('video')!
    const seek = within(dialog).getByRole('slider', { name: 'Seek' })
    expect(seek.getAttribute('aria-valuemax')).toBe('15')
    fireEvent.keyDown(seek, { key: 'ArrowRight' })
    expect(video.currentTime).toBe(5)
    expect(seek.getAttribute('aria-valuetext')).toBe('0:05 of 0:15')
    fireEvent.keyDown(seek, { key: 'End' })
    expect(video.currentTime).toBe(15)
    fireEvent.keyDown(seek, { key: 'ArrowLeft' })
    expect(video.currentTime).toBe(10)
    expect(counter()).toBe('2 / 2')
  })
})

describe('MediaViewer converting', () => {
  it('shows the conversion in place of a video that is not ready', () => {
    show([{ ...VIDEO, converting: { fraction: 0.62 } }])
    const dialog = openAt(1)
    expect(dialog.querySelector('video')).toBeNull()
    const status = within(dialog).getByRole('status')
    expect(status.textContent).toContain('Converting for X')
    expect(status.textContent).toContain('62%')
    expect(status.textContent).toContain("It can be viewed once it's ready.")
    // Clicking the tile isn't the backdrop.
    fireEvent.click(screen.getByTestId('viewer-converting'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('viewerItemsForPost', () => {
  it('lists every file across the thread, labelled by part', () => {
    const base = makePost({ id: 't' })
    const file = (id: string) => ({
      id,
      kind: 'image' as const,
      mime: 'image/png',
      bytes: 100,
      width: 10,
      height: 20,
      durationMs: null,
      alt: null,
      url: `opencat-media://media/${id}.png`
    })
    const part = (i: number, ids: string[]) => ({
      ...base.parts[0]!,
      id: `p${i}`,
      position: i,
      media: ids.map(file)
    })
    const items = viewerItemsForPost({ parts: [part(0, ['a']), part(1, []), part(2, ['b', 'c'])] })
    expect(items.map((i) => [i.url, i.partLabel])).toEqual([
      ['opencat-media://media/a.png', 'Part 1'],
      ['opencat-media://media/b.png', 'Part 3'],
      ['opencat-media://media/c.png', 'Part 3']
    ])
    expect(viewerItemsForPost({ parts: [part(0, ['a'])] })[0]).toMatchObject({
      partLabel: undefined,
      width: 10,
      height: 20,
      sizeBytes: 100
    })
  })
})
