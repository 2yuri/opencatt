import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { RenderToolResult } from '@shared/api'
import { EditorContext, type EditorApi } from '../editor/editorContext'
import { MediaViewerProvider } from '../media/MediaViewer'
import { fakeApi, post } from '../test/fakeApi'
import { RenderCard } from './RenderCard'

afterEach(() => {
  cleanup()
})

const RENDER: RenderToolResult = {
  kind: 'render',
  mediaId: 'r1',
  width: 1200,
  height: 675,
  bytes: 2048,
  url: 'opencat-media://media/r1.png'
}

function show(attachedTo: string | null) {
  const fake = fakeApi([])
  if (attachedTo) {
    const base = post({
      id: attachedTo,
      text: 'Launch',
      scheduledAt: '2026-09-29T08:00:00Z',
      status: 'pending_approval'
    })
    fake.posts.set(attachedTo, {
      ...base,
      parts: [
        {
          ...base.parts[0]!,
          media: [
            { ...RENDER, id: 'r1', kind: 'image', mime: 'image/png', durationMs: null, alt: null }
          ]
        }
      ]
    })
  }
  window.opencat = fake.api
  const editor: EditorApi = { openNew: vi.fn(), openPost: vi.fn() }
  const onOpenPost = vi.fn()
  render(
    <MediaViewerProvider>
      <EditorContext.Provider value={editor}>
        <RenderCard render={RENDER} onOpenPost={onOpenPost} />
      </EditorContext.Provider>
    </MediaViewerProvider>
  )
  return { fake, editor, onOpenPost }
}

describe('RenderCard', () => {
  it('shows a render not attached yet, and starts a new post with it', async () => {
    const { editor, fake } = show(null)
    const card = screen.getByRole('article', { name: 'Rendered image' })
    await waitFor(() => expect(card.textContent).toContain('Not attached to a post yet'))
    expect(card.textContent).toContain('1200 × 675 PNG')

    fireEvent.click(within(card).getByRole('button', { name: 'Use in a new post' }))
    expect(editor.openNew).toHaveBeenCalledWith(undefined, {
      media: [expect.objectContaining({ id: 'r1', url: RENDER.url, width: 1200 })]
    })

    fireEvent.click(within(card).getByRole('button', { name: 'Save image…' }))
    expect(fake.api.media.saveAs).toHaveBeenCalledWith('r1')
  })

  it('shows the post a render is attached to, and opens it', async () => {
    const { onOpenPost } = show('p1')
    const card = screen.getByRole('article', { name: 'Rendered image' })
    await waitFor(() => expect(card.textContent).toMatch(/Attached to the post for \w{3} 29 Sep/))
    expect(card.textContent).toContain('Waiting for your approval')
    expect(within(card).queryByRole('button', { name: 'Use in a new post' })).toBeNull()

    fireEvent.click(within(card).getByRole('button', { name: 'Open post' }))
    expect(onOpenPost).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  it('opens the image in the viewer, with its actions, and closes on Esc', async () => {
    const { editor } = show(null)
    const card = screen.getByRole('article', { name: 'Rendered image' })
    await waitFor(() => expect(card.textContent).toContain('Not attached to a post yet'))
    fireEvent.click(within(card).getByRole('button', { name: 'View image' }))
    let dialog = screen.getByRole('dialog', { name: 'Media viewer' })
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(RENDER.url)
    expect(dialog.textContent).toContain('1200 × 675 · 2 KB')
    expect(within(dialog).getByRole('button', { name: 'Save image…' })).toBeTruthy()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    // A click on the picture itself opens it too; Use in a new post leaves the viewer for the editor.
    fireEvent.click(card.querySelector('img')!)
    dialog = screen.getByRole('dialog', { name: 'Media viewer' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use in a new post' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(editor.openNew).toHaveBeenCalledWith(undefined, {
      media: [expect.objectContaining({ id: 'r1' })]
    })
  })
})

describe('RenderCard for a recorded video', () => {
  it('plays the video in the card and offers Save video…', async () => {
    const fake = fakeApi([])
    window.opencat = fake.api
    const video = {
      ...RENDER,
      mediaId: 'v1',
      url: 'opencat-media://media/v1.mp4',
      durationMs: 15_000
    }
    const { container } = render(<RenderCard render={video} />)
    const card = screen.getByRole('article', { name: 'Recorded video' })
    await waitFor(() => expect(card.textContent).toContain('1200 × 675 MP4 · 0:15'))
    expect(container.querySelector('video')?.getAttribute('src')).toBe(video.url)
    fireEvent.click(within(card).getByRole('button', { name: 'Save video…' }))
    expect(fake.api.media.saveAs).toHaveBeenCalledWith('v1')
  })
})
