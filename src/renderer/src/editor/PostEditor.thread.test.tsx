import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { MediaKind, MediaProgressEvent, Post, PostMedia } from '@shared/api'
import { makePost } from '../day/testPosts'
import { MediaViewerProvider } from '../media/MediaViewer'
import { PostEditor } from './PostEditor'

let posts: Record<string, ReturnType<typeof vi.fn>>
let media: Record<string, ReturnType<typeof vi.fn>>
let onClose: ReturnType<typeof vi.fn<() => void>>
let nextId = 0
let progressListeners: Set<(event: MediaProgressEvent) => void>

function file(kind: MediaKind): PostMedia {
  const id = `m${++nextId}`
  return {
    id,
    kind,
    mime: kind === 'video' ? 'video/mp4' : kind === 'gif' ? 'image/gif' : 'image/png',
    bytes: 10,
    width: null,
    height: null,
    durationMs: null,
    alt: null,
    url: `opencat-media://media/${id}`
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-26T09:20:00.000Z'))
  nextId = 0
  progressListeners = new Set()
  onClose = vi.fn<() => void>()
  posts = {
    create: vi.fn().mockResolvedValue(makePost({ id: 'new' })),
    update: vi.fn().mockResolvedValue(makePost({ id: 'p' }))
  }
  media = {
    pick: vi.fn(),
    import: vi.fn(),
    discard: vi.fn().mockResolvedValue(undefined),
    pathForFile: vi.fn((f: File) => `/Users/me/${f.name}`),
    savePasted: vi.fn().mockResolvedValue('/tmp/pasted/clip.png'),
    cancelImport: vi.fn().mockResolvedValue(undefined),
    onProgress: vi.fn((listener: (event: MediaProgressEvent) => void) => {
      progressListeners.add(listener)
      return () => progressListeners.delete(listener)
    })
  }
  window.opencat = { posts, media } as unknown as typeof window.opencat
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function open(post: Post | null = null): void {
  render(<PostEditor post={post} day="2026-10-02" focus="text" onClose={onClose} />)
}

const button = (name: string | RegExp): HTMLButtonElement => screen.getByRole('button', { name })
const part = (n: number, of: number): HTMLElement =>
  screen.getByRole('region', { name: `Post ${n} of ${of}` })
const type = (el: HTMLElement, value: string): void => {
  fireEvent.change(el, { target: { value } })
}

describe('PostEditor threads', () => {
  it('builds a thread, reorders it and saves the parts in order', async () => {
    open()
    type(screen.getByRole('textbox', { name: 'Post text' }), 'one')
    fireEvent.click(button('Add to thread'))
    fireEvent.click(button('Add to thread'))
    expect(screen.getByRole('heading', { name: 'New thread' })).toBeTruthy()
    type(within(part(2, 3)).getByRole('textbox'), 'two')
    type(within(part(3, 3)).getByRole('textbox'), 'three')

    fireEvent.click(button('Move post 3 up'))
    expect(within(part(2, 3)).getByRole('textbox')).toHaveProperty('value', 'three')
    expect(button('Move post 1 up').disabled).toBe(true)
    expect(button('Move post 3 down').disabled).toBe(true)

    fireEvent.click(button('Remove post 1'))
    expect(within(part(1, 2)).getByRole('textbox')).toHaveProperty('value', 'three')

    fireEvent.click(button('Schedule'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posts.create).toHaveBeenCalledWith({
      parts: [
        { text: 'three', media: [] },
        { text: 'two', media: [] }
      ],
      scheduledAt: '2026-10-02T08:00:00.000Z'
    })
  })

  it('keeps a counter per part and names the part that is too long', () => {
    open()
    fireEvent.click(button('Add to thread'))
    type(within(part(1, 2)).getByRole('textbox'), 'short')
    type(within(part(2, 2)).getByRole('textbox'), 'a'.repeat(285))
    expect(within(part(1, 2)).getByTestId('counter').textContent).toBe('5 / 280')
    expect(within(part(2, 2)).getByTestId('counter').textContent).toBe('285 / 280')
    expect(button('Schedule').disabled).toBe(true)
    fireEvent.keyDown(within(part(1, 2)).getByRole('textbox'), { key: 'Enter', ctrlKey: true })
    expect(within(part(2, 2)).getByRole('alert').textContent).toBe(
      'Post 2 of the thread is 5 over the 280 limit.'
    )
  })

  it('asks for text or media in an empty part of a thread', () => {
    open()
    type(screen.getByRole('textbox', { name: 'Post text' }), 'hi')
    fireEvent.click(button('Add to thread'))
    fireEvent.click(button('Schedule'))
    expect(within(part(2, 2)).getByRole('alert').textContent).toBe(
      'Post 2 of the thread needs text or media.'
    )
    expect(posts.create).not.toHaveBeenCalled()
  })

  it('stops at 25 posts', () => {
    open()
    for (let i = 0; i < 24; i++) fireEvent.click(button('Add to thread'))
    expect(button('Threads stop at 25 posts').disabled).toBe(true)
    expect(screen.getAllByRole('region')).toHaveLength(25)
  })

  it('keeps parts already on X as they are, and lets the rest change', async () => {
    open(
      makePost({
        id: 'p',
        status: 'failed',
        errorCode: 'retries_exhausted',
        error: 'X was down.',
        scheduledAt: '2026-09-26T08:00:00.000Z',
        parts: [
          {
            id: 'a',
            position: 0,
            text: 'posted',
            media: [],
            remoteId: '1',
            remoteUrl: 'https://x.com/me/status/1',
            postedAt: '2026-09-26T08:00:00.000Z'
          },
          {
            id: 'b',
            position: 1,
            text: 'not yet',
            media: [],
            remoteId: null,
            remoteUrl: null,
            postedAt: null
          }
        ]
      })
    )
    const posted = part(1, 2)
    expect(within(posted).queryByRole('textbox')).toBeNull()
    expect(within(posted).getByRole('link', { name: 'View on X' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Remove post 1' })).toBeNull()
    expect(button('Move post 2 up').disabled).toBe(true)
    type(within(part(2, 2)).getByRole('textbox'), 'edited')
    fireEvent.click(button('Post now'))
    await waitFor(() => expect(posts.update).toHaveBeenCalled())
    expect(posts.update.mock.calls[0][1].parts).toEqual([
      { text: 'posted', media: [] },
      { text: 'edited', media: [] }
    ])
  })
})

describe('PostEditor media', () => {
  it('adds media from the picker, with a preview and alt text, and saves it on the part', async () => {
    const image = file('image')
    media.pick.mockResolvedValue([image])
    open()
    fireEvent.click(button('Add media'))
    const preview = await screen.findByRole('img', { name: 'Image 1' })
    expect(preview.getAttribute('src')).toBe(image.url)
    type(screen.getByLabelText('Alt text for image 1'), 'Our new logo')
    fireEvent.click(button('Schedule'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posts.create).toHaveBeenCalledWith({
      parts: [{ text: '', media: [{ id: image.id, alt: 'Our new logo' }] }],
      scheduledAt: '2026-10-02T08:00:00.000Z'
    })
    expect(media.discard).not.toHaveBeenCalled()
  })

  it('imports dropped files by path', async () => {
    media.import.mockResolvedValue([file('video')])
    open()
    const drop = new File(['x'], 'clip.mp4', { type: 'video/mp4' })
    fireEvent.drop(screen.getByRole('region', { name: 'Post text' }), {
      dataTransfer: { files: [drop], types: ['Files'] }
    })
    await waitFor(() => expect(media.import).toHaveBeenCalledWith(['/Users/me/clip.mp4']))
    expect(await screen.findByLabelText('Video 1')).toBeTruthy()
  })

  it('pastes a screenshot, which has no file behind it, through a saved copy (OP-89)', async () => {
    media.import.mockResolvedValue([file('image')])
    media.pathForFile.mockReturnValue('')
    open()
    const shot = new File([new Uint8Array([137, 80])], 'image.png', { type: 'image/png' })
    fireEvent.paste(screen.getByRole('textbox', { name: 'Post text' }), {
      clipboardData: { files: [shot], types: ['Files'] }
    })
    await waitFor(() => expect(media.import).toHaveBeenCalledWith(['/tmp/pasted/clip.png']))
    expect(media.savePasted).toHaveBeenCalledWith(new Uint8Array([137, 80]), 'image/png')
    expect(await screen.findByRole('img', { name: 'Image 1' })).toBeTruthy()
  })

  it('leaves a text paste to the text box', () => {
    open()
    const event = fireEvent.paste(screen.getByRole('textbox', { name: 'Post text' }), {
      clipboardData: { files: [], types: ['text/plain'] }
    })
    expect(event).toBe(true)
    expect(media.import).not.toHaveBeenCalled()
  })

  it('refuses a fifth image and throws the new import away', async () => {
    media.pick.mockResolvedValueOnce([file('image'), file('image'), file('image'), file('image')])
    open()
    fireEvent.click(button('Add media'))
    await screen.findByRole('img', { name: 'Image 4' })
    media.pick.mockResolvedValueOnce([file('image')])
    fireEvent.click(button('Add media'))
    expect((await screen.findByRole('alert')).textContent).toBe('X allows up to 4 images per post.')
    expect(screen.getAllByRole('img')).toHaveLength(4)
    expect(media.discard).toHaveBeenCalledWith('m5')
  })

  it('refuses a video next to an image', async () => {
    media.pick.mockResolvedValueOnce([file('image')]).mockResolvedValueOnce([file('video')])
    open()
    fireEvent.click(button('Add media'))
    await screen.findByRole('img', { name: 'Image 1' })
    fireEvent.click(button('Add media'))
    expect((await screen.findByRole('alert')).textContent).toContain('only media')
    expect(media.discard).toHaveBeenCalledWith('m2')
  })

  it('shows what main refused, such as a file type X does not take', async () => {
    media.pick.mockRejectedValue(
      new Error(
        "Error invoking remote method 'media:pick': PostRuleError: X doesn't accept .bmp files"
      )
    )
    open()
    fireEvent.click(button('Add media'))
    expect((await screen.findByRole('alert')).textContent).toBe("X doesn't accept .bmp files")
  })

  it('discards an import when it is removed, and all imports when the editor is closed unsaved', async () => {
    media.pick.mockResolvedValue([file('image'), file('image')])
    open()
    fireEvent.click(button('Add media'))
    await screen.findByRole('img', { name: 'Image 2' })
    fireEvent.click(button('Remove image 1'))
    expect(media.discard).toHaveBeenCalledWith('m1')
    fireEvent.click(button('Cancel'))
    fireEvent.click(button('Discard'))
    expect(media.discard).toHaveBeenCalledWith('m2')
    expect(onClose).toHaveBeenCalled()
  })

  it('leaves media already saved on the post to main when it is removed', async () => {
    const saved = { ...file('image'), alt: 'old' }
    open(
      makePost({
        id: 'p',
        scheduledAt: '2026-10-02T08:00:00.000Z',
        parts: [
          {
            id: 'a',
            position: 0,
            text: 'with image',
            media: [saved],
            remoteId: null,
            remoteUrl: null,
            postedAt: null
          }
        ]
      })
    )
    fireEvent.click(button('Remove image 1'))
    fireEvent.click(button('Save'))
    await waitFor(() => expect(posts.update).toHaveBeenCalled())
    expect(posts.update.mock.calls[0][1].parts).toEqual([{ text: 'with image', media: [] }])
    expect(media.discard).not.toHaveBeenCalled()
  })

  it('shows every part and its media when the post is read-only', () => {
    const image = file('image')
    open(
      makePost({
        id: 'p',
        status: 'posted',
        postedAt: '2026-09-26T08:00:00.000Z',
        parts: [
          {
            id: 'a',
            position: 0,
            text: 'first',
            media: [image],
            remoteId: '1',
            remoteUrl: 'https://x.com/me/status/1',
            postedAt: null
          },
          {
            id: 'b',
            position: 1,
            text: 'second',
            media: [],
            remoteId: '2',
            remoteUrl: 'https://x.com/me/status/2',
            postedAt: null
          }
        ]
      })
    )
    expect(within(part(1, 2)).getByRole('img')).toBeTruthy()
    expect(within(part(2, 2)).getByText('second')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add media' })).toBeNull()
  })
})

/** An import main is still working on; the test settles it. */
function pendingImport(): {
  resolve: (media: PostMedia[]) => void
  reject: (err: Error) => void
} {
  let resolve!: (media: PostMedia[]) => void
  let reject!: (err: Error) => void
  media.import.mockReturnValue(
    new Promise<PostMedia[]>((res, rej) => {
      resolve = res
      reject = rej
    })
  )
  return { resolve, reject }
}

function dropVideo(name = 'IMG_4127.MOV'): void {
  fireEvent.drop(screen.getByRole('region', { name: 'Post text' }), {
    dataTransfer: { files: [new File(['x'], name, { type: 'video/quicktime' })], types: ['Files'] }
  })
}

const progress = (event: MediaProgressEvent): void =>
  act(() => progressListeners.forEach((listener) => listener(event)))
const converting = (): HTMLElement | null =>
  screen.queryByRole('status', { name: /^Converting .* for X$/ })
const wait = (ms: number): Promise<void> =>
  act(() => new Promise<void>((done) => setTimeout(done, ms)))

describe('PostEditor: converting a video', () => {
  it('shows the progress after a moment, follows main, and holds saving until it is done', async () => {
    const pending = pendingImport()
    open()
    type(screen.getByRole('textbox', { name: 'Post text' }), 'Launch video')
    dropVideo()
    expect(converting()).toBeNull()
    expect(button('Schedule').disabled).toBe(true)
    expect(button('Post now').disabled).toBe(true)

    const row = await screen.findByRole('status', { name: 'Converting IMG_4127.MOV for X' })
    expect(row.textContent).toContain('Converting for X')
    expect(row.textContent).toContain('0%')

    progress({ path: '/Users/me/IMG_4127.MOV', fraction: 0.62 })
    expect(row.textContent).toContain('62%')
    expect(within(row).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('62')
    // Another file's conversion, say from the chat, doesn't move this row.
    progress({ path: '/Users/me/other.mov', fraction: 0.9 })
    expect(row.textContent).toContain('62%')

    pending.resolve([file('video')])
    expect(await screen.findByLabelText('Video 1')).toBeTruthy()
    expect(converting()).toBeNull()
    expect(button('Schedule').disabled).toBe(false)
    expect(button('Post now').disabled).toBe(false)
  })

  it('never shows the row for a video that needs no conversion', async () => {
    media.import.mockResolvedValue([file('video')])
    open()
    dropVideo('clip.mp4')
    expect(await screen.findByLabelText('Video 1')).toBeTruthy()
    await wait(400)
    expect(converting()).toBeNull()
  })

  it('cancels the conversion and clears the row without an error', async () => {
    const pending = pendingImport()
    open()
    dropVideo()
    const row = await screen.findByRole('status', { name: 'Converting IMG_4127.MOV for X' })
    fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }))
    expect(media.cancelImport).toHaveBeenCalled()

    pending.reject(
      new Error(
        "Error invoking remote method 'media:import': MediaError: Adding the video was cancelled."
      )
    )
    await waitFor(() => expect(converting()).toBeNull())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(button('Schedule').disabled).toBe(false)
    expect(button('Add media').disabled).toBe(false)
  })

  it('shows what main refused in the part, until it is dismissed', async () => {
    const pending = pendingImport()
    open()
    dropVideo()
    await screen.findByRole('status', { name: 'Converting IMG_4127.MOV for X' })
    const refusal =
      'X takes videos up to 2 minutes 20 seconds. This one is 3:05, so trim it and add it again.'
    pending.reject(new Error(`Error invoking remote method 'media:import': MediaError: ${refusal}`))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(refusal)
    expect(converting()).toBeNull()
    expect(button('Schedule').disabled).toBe(false)
    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('PostEditor seeded with a render', () => {
  it('starts with the media in part 1, saves it, and never discards it on close', async () => {
    const drawn = file('image')
    const { rerender } = render(
      <PostEditor
        post={null}
        day="2026-10-02"
        seed={{ media: [drawn] }}
        focus="text"
        onClose={onClose}
      />
    )
    expect(screen.getByRole('img')).toBeTruthy()

    fireEvent.click(button('Cancel'))
    expect(media.discard).not.toHaveBeenCalled()

    rerender(
      <PostEditor
        post={null}
        day="2026-10-02"
        seed={{ media: [drawn] }}
        focus="text"
        onClose={onClose}
      />
    )
    type(screen.getByRole('textbox', { name: 'Post text' }), 'Launch day')
    fireEvent.click(button('Schedule'))
    await waitFor(() => expect(posts.create).toHaveBeenCalled())
    expect(posts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [{ text: 'Launch day', media: [{ id: drawn.id, alt: null }] }]
      })
    )
  })
})

describe('PostEditor media viewer (OP-88)', () => {
  it("opens the viewer over the editor on the part's own media, and Esc closes only the viewer", () => {
    const [a, b, c] = [file('image'), file('image'), file('image')]
    const base = makePost({ id: 'p', status: 'scheduled' })
    render(
      <MediaViewerProvider>
        <PostEditor
          post={{
            ...base,
            parts: [
              { ...base.parts[0]!, id: 'x', position: 0, text: 'one', media: [a!] },
              { ...base.parts[0]!, id: 'y', position: 1, text: 'two', media: [b!, c!] }
            ]
          }}
          focus="text"
          onClose={onClose}
        />
      </MediaViewerProvider>
    )
    const second = part(2, 2)
    const thumbs = within(second).getAllByRole('button', { name: 'View image' })
    expect(thumbs).toHaveLength(2)

    // Remove still removes, without opening the viewer.
    fireEvent.click(within(second).getByRole('button', { name: 'Remove image 2' }))
    expect(screen.queryByRole('dialog', { name: 'Media viewer' })).toBeNull()
    expect(within(second).getAllByRole('button', { name: 'View image' })).toHaveLength(1)

    fireEvent.click(within(part(1, 2)).getByRole('button', { name: 'View image' }))
    const viewer = screen.getByRole('dialog', { name: 'Media viewer' })
    expect(viewer.querySelector('img')?.getAttribute('src')).toBe(a!.url)
    expect(viewer.textContent).toContain('Part 1')
    expect(screen.queryByTestId('viewer-counter')).toBeNull()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Media viewer' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })
})
