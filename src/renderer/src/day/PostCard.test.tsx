import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Post, PostErrorCode, XAccount } from '@shared/api'
import { AuthError } from '@shared/authErrors'
import { EditorContext, type EditorApi } from '../editor/editorContext'
import { MediaViewerContext, type MediaViewerApi } from '../media/viewerContext'
import { PostCard } from './PostCard'
import { makePost } from './testPosts'

let editor: { openNew: ReturnType<typeof vi.fn>; openPost: ReturnType<typeof vi.fn> }
let update: ReturnType<typeof vi.fn>
let auth: {
  connect: ReturnType<typeof vi.fn>
  status: ReturnType<typeof vi.fn>
  onChanged: ReturnType<typeof vi.fn>
}

const account = (id: string, handle: string): XAccount => ({
  id,
  handle,
  name: null,
  avatarUrl: null,
  mode: 'oauth2',
  needsReconnect: false
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-26T09:20:00.000Z'))
  editor = { openNew: vi.fn(), openPost: vi.fn() }
  update = vi.fn().mockResolvedValue(undefined)
  auth = {
    connect: vi.fn(),
    status: vi.fn().mockResolvedValue({ accounts: [], activeAccountId: null, secureStorage: true }),
    onChanged: vi.fn(() => () => {})
  }
  window.opencat = { posts: { update }, auth } as unknown as typeof window.opencat
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderCard(post: Post): void {
  render(
    <MemoryRouter initialEntries={['/day/2026-09-28']}>
      <EditorContext.Provider value={editor as unknown as EditorApi}>
        <Routes>
          <Route path="/day/:date" element={<PostCard post={post} />} />
        </Routes>
      </EditorContext.Provider>
    </MemoryRouter>
  )
}

const failed = (errorCode: PostErrorCode | null, extra: Partial<Post> = {}): Post =>
  makePost({ id: 'f', status: 'failed', errorCode, error: 'It failed.', ...extra })

const buttons = (): string[] =>
  screen
    .getAllByRole('button')
    .map((b) => b.textContent ?? '')
    .filter((name) => !name.includes('It failed') && !name.startsWith('10:00'))

describe('PostCard', () => {
  it('shows the time the user picked, and when a retry is due', () => {
    renderCard(makePost({ id: 'r', nextAttemptAt: '2026-09-28T08:06:00.000Z' }))
    expect(screen.getByText('10:00')).toBeTruthy()
    expect(screen.getByText('Retrying at 09:06')).toBeTruthy()
  })

  it('opens the editor when clicked', () => {
    const post = makePost({ id: 's' })
    renderCard(post)
    fireEvent.click(screen.getByRole('button', { name: 'Edit post at 10:00' }))
    expect(editor.openPost).toHaveBeenCalledWith(post)
  })

  it('opens a posted post to view it', () => {
    renderCard(makePost({ id: 'p', status: 'posted', remoteId: '1' }))
    expect(screen.getByRole('button', { name: 'View post at 10:00' })).toBeTruthy()
  })

  it.each([
    ['missed', ['Post now', 'Reschedule']],
    ['retries_exhausted', ['Post now', 'Reschedule']],
    ['uncertain', ['Post now', 'Reschedule']],
    ['rejected', ['Edit']],
    ['auth', ['Reconnect X']],
    [null, ['Post now', 'Reschedule']]
  ] as const)('gives a %s failure the buttons %j', (code, expected) => {
    renderCard(failed(code))
    expect(buttons()).toEqual(expected)
  })

  it('posts a missed post now by moving it to this moment', async () => {
    renderCard(failed('missed'))
    fireEvent.click(screen.getByRole('button', { name: 'Post now' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('f', { scheduledAt: '2026-09-26T09:20:00.000Z' })
    )
  })

  it('opens the editor on the date to reschedule', () => {
    const post = failed('retries_exhausted')
    renderCard(post)
    fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
    expect(editor.openPost).toHaveBeenCalledWith(post, { focus: 'time' })
  })

  it('opens the editor for a rejected post, since posting the same text fails again', () => {
    const post = failed('rejected')
    renderCard(post)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(editor.openPost).toHaveBeenCalledWith(post)
  })

  it('links an uncertain post to the profile and warns before posting again', async () => {
    renderCard(failed('uncertain', { accountId: '12345' }))
    expect(screen.getByRole('link', { name: 'Check on X' }).getAttribute('href')).toBe(
      'https://x.com/i/user/12345'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Post now' }))
    expect(screen.getByText('This may already be on X. Post it again?')).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Post anyway' }))
    await waitFor(() => expect(update).toHaveBeenCalled())
  })

  it('links Check on X to the handle once auth.status knows the account', async () => {
    auth.status.mockResolvedValue({
      accounts: [account('12345', 'acme')],
      activeAccountId: '12345',
      secureStorage: true
    })
    renderCard(failed('uncertain', { accountId: '12345' }))
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Check on X' }).getAttribute('href')).toBe(
        'https://x.com/acme'
      )
    )
  })

  it('reconnects an auth failure in place, then offers Post now without resending', async () => {
    let finish: (value: { accountId: string; handle: string }) => void = () => {}
    auth.connect.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderCard(failed('auth', { accountId: '12345' }))
    expect(screen.queryByRole('button', { name: 'Post now' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect X' }))
    expect(auth.connect).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Finish signing in to X in your browser…')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Connecting…' }) as HTMLButtonElement).disabled
    ).toBe(true)

    finish({ accountId: '12345', handle: 'acme' })
    await screen.findByText('Connected as @acme. Nothing is resent on its own.')
    expect(screen.getByText('Reconnected')).toBeTruthy()
    expect(screen.queryByText('It failed.')).toBeNull()
    expect(buttons()).toEqual(['Post now', 'Reschedule'])
    expect(update).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Post now' }))
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('f', { scheduledAt: '2026-09-26T09:20:00.000Z' })
    )
  })

  it('clears when the account is reconnected anywhere else, as auth.status reports', async () => {
    let tell: (status: unknown) => void = () => {}
    auth.onChanged.mockImplementation((listener: (status: unknown) => void) => {
      tell = listener
      return () => {}
    })
    auth.status.mockResolvedValue({
      accounts: [{ ...account('12345', 'acme'), needsReconnect: true }],
      activeAccountId: '12345',
      secureStorage: true
    })
    renderCard(failed('auth', { accountId: '12345' }))
    await waitFor(() => expect(auth.status).toHaveBeenCalled())
    expect(buttons()).toEqual(['Reconnect X'])

    act(() =>
      tell({ accounts: [account('12345', 'acme')], activeAccountId: '12345', secureStorage: true })
    )
    await screen.findByText('Connected as @acme. Nothing is resent on its own.')
    expect(buttons()).toEqual(['Post now', 'Reschedule'])
    expect(auth.connect).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()

    act(() =>
      tell({
        accounts: [{ ...account('12345', 'acme'), needsReconnect: true }],
        activeAccountId: '12345',
        secureStorage: true
      })
    )
    expect(buttons()).toEqual(['Reconnect X'])
  })

  it('asks again after a reconnect here if X signs the account out later', async () => {
    let tell: (status: unknown) => void = () => {}
    auth.onChanged.mockImplementation((listener: (status: unknown) => void) => {
      tell = listener
      return () => {}
    })
    auth.connect.mockResolvedValue({ accountId: '12345', handle: 'acme' })
    renderCard(failed('auth', { accountId: '12345' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect X' }))
    await screen.findByText('Reconnected')
    act(() =>
      tell({
        accounts: [{ ...account('12345', 'acme'), needsReconnect: true }],
        activeAccountId: '12345',
        secureStorage: true
      })
    )
    expect(buttons()).toEqual(['Reconnect X'])
  })

  it('shows why a reconnect failed and lets the user try again', async () => {
    auth.connect.mockRejectedValueOnce(new AuthError('callback_mismatch'))
    renderCard(failed('auth'))
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect X' }))
    await screen.findByText(
      "X didn't accept the callback. Check your X app's Callback URI is http://127.0.0.1:47823/callback."
    )
    expect(screen.queryByRole('button', { name: 'Post now' })).toBeNull()
    auth.connect.mockResolvedValueOnce({ accountId: '12345', handle: 'acme' })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByText('Reconnected')
    expect(auth.connect).toHaveBeenCalledTimes(2)
  })

  it('keeps only the latest sign-in when the user opens X again', async () => {
    let cancelFirst: (err: unknown) => void = () => {}
    auth.connect
      .mockReturnValueOnce(new Promise((_, reject) => (cancelFirst = reject)))
      .mockResolvedValueOnce({ accountId: '12345', handle: 'acme' })
    renderCard(failed('auth'))
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect X' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open X again' }))
    await screen.findByText('Reconnected')
    cancelFirst(new AuthError('cancelled'))
    await Promise.resolve()
    expect(screen.queryByText("Sign-in was cancelled. Try again when you're ready.")).toBeNull()
    expect(screen.getByText('Reconnected')).toBeTruthy()
  })

  it('does not count signing in as another account as reconnecting this one', async () => {
    auth.connect.mockResolvedValue({ accountId: '999', handle: 'someone' })
    auth.status.mockResolvedValue({
      accounts: [{ ...account('12345', 'acme'), needsReconnect: true }, account('999', 'someone')],
      activeAccountId: '999',
      secureStorage: true
    })
    renderCard(failed('auth', { accountId: '12345' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect X' }))
    await screen.findByText(
      'You signed in as @someone. This post is for @acme: sign in to X as that account and try again.'
    )
    expect(screen.queryByText('Reconnected')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Post now' })).toBeNull()
  })

  it('shows no failure buttons on a scheduled post', () => {
    renderCard(makePost({ id: 's' }))
    expect(screen.queryByRole('button', { name: 'Post now' })).toBeNull()
  })
})

describe('PostCard threads and media', () => {
  const image = (id: string, kind: 'image' | 'video' = 'image') => ({
    id,
    kind,
    mime: kind === 'video' ? 'video/mp4' : 'image/png',
    bytes: 1,
    width: null,
    height: null,
    durationMs: null,
    alt: null,
    url: `opencat-media://media/${id}`
  })
  const part = (i: number, media: ReturnType<typeof image>[] = []) => ({
    id: `part${i}`,
    position: i,
    text: `part ${i}`,
    media,
    remoteId: null,
    remoteUrl: null,
    postedAt: null
  })

  it('shows a thread count', () => {
    renderCard(makePost({ id: 't', text: 'part 0', parts: [part(0), part(1), part(2)] }))
    expect(screen.getByText('Thread of 3')).toBeTruthy()
  })

  it('shows the first media as a thumbnail, with how many more there are', () => {
    renderCard(
      makePost({
        id: 't',
        parts: [part(0), part(1, [image('a'), image('b')]), part(2, [image('c')])]
      })
    )
    const thumb = screen.getByTestId('card-thumb')
    expect(thumb.querySelector('img')?.getAttribute('src')).toBe('opencat-media://media/a')
    expect(thumb.textContent).toBe('+2')
  })

  it('previews a video thumbnail without loading the whole file', () => {
    renderCard(makePost({ id: 'v', parts: [part(0, [image('v', 'video')])] }))
    const video = screen.getByTestId('card-thumb').querySelector('video')
    expect(video?.getAttribute('preload')).toBe('metadata')
  })

  it('opens the viewer from the thumbnail, not the editor', () => {
    const viewer: MediaViewerApi = { open: vi.fn(), close: vi.fn() }
    const p = makePost({
      id: 't',
      parts: [part(0, [image('a')]), part(1, [image('b'), image('c', 'video')])]
    })
    render(
      <MemoryRouter initialEntries={['/day/2026-09-28']}>
        <MediaViewerContext.Provider value={viewer}>
          <EditorContext.Provider value={editor as unknown as EditorApi}>
            <PostCard post={p} />
          </EditorContext.Provider>
        </MediaViewerContext.Provider>
      </MemoryRouter>
    )
    const thumb = screen.getByRole('button', { name: 'View image' })
    expect(thumb).toBe(screen.getByTestId('card-thumb'))
    // Not inside the card's own button.
    expect(thumb.closest('button')?.parentElement?.closest('button')).toBeNull()
    fireEvent.click(thumb)
    expect(viewer.open).toHaveBeenCalledWith(
      [
        expect.objectContaining({ url: 'opencat-media://media/a', partLabel: 'Part 1' }),
        expect.objectContaining({ url: 'opencat-media://media/b', partLabel: 'Part 2' }),
        expect.objectContaining({
          url: 'opencat-media://media/c',
          kind: 'video',
          partLabel: 'Part 2'
        })
      ],
      0
    )
    expect(editor.openPost).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Edit post at 10:00' }))
    expect(editor.openPost).toHaveBeenCalledWith(p)
  })

  it('shows neither for a plain post', () => {
    renderCard(makePost({ id: 's' }))
    expect(screen.queryByText(/Thread ·/)).toBeNull()
    expect(screen.queryByTestId('card-thumb')).toBeNull()
  })
})
