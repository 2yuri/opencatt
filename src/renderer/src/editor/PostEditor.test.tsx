import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Post, XAccount } from '@shared/api'
import { xAccount } from '../test/fakeApi'
import { makePost } from '../day/testPosts'
import { PostEditor } from './PostEditor'

let posts: Record<string, ReturnType<typeof vi.fn>>
let onClose: ReturnType<typeof vi.fn<() => void>>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // 10:20 on 26 September 2026 in Europe/Lisbon (UTC+1).
  vi.setSystemTime(new Date('2026-09-26T09:20:00.000Z'))
  onClose = vi.fn<() => void>()
  posts = {
    create: vi.fn().mockResolvedValue(makePost({ id: 'new' })),
    update: vi.fn().mockResolvedValue(makePost({ id: 'p' })),
    delete: vi.fn().mockResolvedValue(undefined)
  }
  window.opencat = { posts } as unknown as typeof window.opencat
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function open(post: Post | null, props: { day?: string; focus?: 'text' | 'time' } = {}): void {
  render(<PostEditor post={post} day={props.day} focus={props.focus ?? 'text'} onClose={onClose} />)
}

const textBox = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'Post text' })
const dateBox = (): HTMLInputElement => screen.getByLabelText('Date')
const timeBox = (): HTMLInputElement => screen.getByLabelText('Time')
const button = (name: string): HTMLButtonElement => screen.getByRole('button', { name })
const type = (el: HTMLElement, value: string): void => {
  fireEvent.change(el, { target: { value } })
}

describe('PostEditor: sizing', () => {
  it('fits the window: at most 640px wide and 64px short of the window, body scrolling inside', () => {
    open(null, { day: '2026-10-02' })
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('w-[min(640px,calc(100vw-64px))]')
    expect(dialog.className).toContain('max-h-[calc(100vh-64px)]')
    expect(dialog.className).toContain('overflow-hidden')
    const [header, body, footer] = Array.from(dialog.children) as HTMLElement[]
    expect(header.tagName).toBe('HEADER')
    expect(header.className).toContain('shrink-0')
    expect(body.className).toContain('overflow-y-auto')
    expect(body.className).toContain('min-h-0')
    expect(footer.className).toContain('shrink-0')
  })
})

describe('PostEditor: a new post', () => {
  it('starts on the given day at 09:00 with the text box focused', () => {
    open(null, { day: '2026-10-02' })
    expect(screen.getByRole('heading', { name: 'New post' })).toBeTruthy()
    expect(dateBox().value).toBe('2026-10-02')
    expect(timeBox().value).toBe('09:00')
    expect(document.activeElement).toBe(textBox())
  })

  it('schedules the post at the chosen local time, stored as UTC', async () => {
    open(null, { day: '2026-10-02' })
    type(textBox(), 'Hello from OpenCatt')
    type(timeBox(), '14:30')
    fireEvent.click(button('Schedule'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posts.create).toHaveBeenCalledWith({
      parts: [{ text: 'Hello from OpenCatt', media: [] }],
      scheduledAt: '2026-10-02T13:30:00.000Z'
    })
  })

  it('counts down as X counts, and blocks saving over 280', () => {
    open(null)
    type(textBox(), `read https://example.com/${'x'.repeat(80)}`)
    expect(screen.getByTestId('counter').textContent).toBe('28 / 280')
    type(textBox(), 'a'.repeat(281))
    expect(screen.getByTestId('counter').textContent).toBe('281 / 280')
    expect(screen.getByTestId('counter').className).toContain('over')
    expect(button('Schedule').disabled).toBe(true)
    fireEvent.keyDown(textBox(), { key: 'Enter', ctrlKey: true })
    expect(screen.getByRole('alert').textContent).toContain('1 over')
    expect(posts.create).not.toHaveBeenCalled()
  })

  it('refuses empty text', () => {
    open(null)
    fireEvent.click(button('Schedule'))
    expect(screen.getByRole('alert').textContent).toBe('Write something first.')
  })

  it('refuses a time that has passed', () => {
    open(null)
    type(textBox(), 'too late')
    type(timeBox(), '08:00')
    fireEvent.click(button('Schedule'))
    expect(screen.getByRole('alert').textContent).toContain('already passed')
    expect(posts.create).not.toHaveBeenCalled()
  })

  it('posts now by scheduling it for this moment', async () => {
    open(null)
    type(textBox(), 'right now')
    fireEvent.click(button('Post now'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posts.create).toHaveBeenCalledWith({
      parts: [{ text: 'right now', media: [] }],
      scheduledAt: '2026-09-26T09:20:00.000Z'
    })
  })

  it('saves with Ctrl/Cmd+Enter', async () => {
    open(null)
    type(textBox(), 'shortcut')
    fireEvent.keyDown(textBox(), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(posts.create).toHaveBeenCalled())
  })

  it('shows what the main process refused', async () => {
    posts.create.mockRejectedValue(
      new Error(
        "Error invoking remote method 'posts:create': PostRuleError: A post needs some text"
      )
    )
    open(null)
    type(textBox(), 'x')
    fireEvent.click(button('Schedule'))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'PostRuleError: A post needs some text'
    )
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('PostEditor: closing', () => {
  it('closes straight away when nothing changed', () => {
    open(null)
    fireEvent.keyDown(textBox(), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('asks before throwing away changes', () => {
    open(null)
    type(textBox(), 'draft')
    fireEvent.keyDown(textBox(), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Close without saving your changes?')).toBeTruthy()
    fireEvent.click(button('Keep editing'))
    expect(textBox().value).toBe('draft')
    fireEvent.click(button('Cancel'))
    fireEvent.click(button('Discard'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('PostEditor: an existing post', () => {
  const scheduled = makePost({
    id: 'p',
    text: 'Launch day',
    scheduledAt: '2026-09-28T08:00:00.000Z'
  })

  it('opens with its text and local time', () => {
    open(scheduled)
    expect(screen.getByRole('heading', { name: 'Edit post' })).toBeTruthy()
    expect(textBox().value).toBe('Launch day')
    expect(dateBox().value).toBe('2026-09-28')
    expect(timeBox().value).toBe('09:00')
  })

  it('reschedules to another day', async () => {
    open(scheduled, { focus: 'time' })
    expect(document.activeElement).toBe(dateBox())
    type(dateBox(), '2026-09-30')
    fireEvent.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posts.update).toHaveBeenCalledWith('p', {
      parts: [{ text: 'Launch day', media: [] }],
      scheduledAt: '2026-09-30T08:00:00.000Z'
    })
  })

  it('deletes only after confirming', async () => {
    open(scheduled)
    fireEvent.click(button('Delete'))
    expect(posts.delete).not.toHaveBeenCalled()
    expect(screen.getByText("Delete this post? This can't be undone.")).toBeTruthy()
    fireEvent.click(button('Delete'))
    await waitFor(() => expect(posts.delete).toHaveBeenCalledWith('p'))
    expect(onClose).toHaveBeenCalled()
  })

  it('needs a new time to save a missed post, or Post now', async () => {
    const missed = makePost({
      id: 'p',
      text: 'Good morning',
      status: 'failed',
      scheduledAt: '2026-09-26T06:00:00.000Z',
      error: 'Missed: the app was closed.',
      errorCode: 'missed'
    })
    open(missed)
    expect(screen.getByRole('alert').textContent).toBe('Missed: the app was closed.')
    fireEvent.click(button('Save'))
    expect(screen.getAllByRole('alert')[1].textContent).toContain('already passed')
    fireEvent.click(button('Post now'))
    await waitFor(() => expect(posts.update).toHaveBeenCalled())
    expect(posts.update).toHaveBeenCalledWith('p', {
      parts: [{ text: 'Good morning', media: [] }],
      scheduledAt: '2026-09-26T09:20:00.000Z'
    })
  })

  it('warns before posting an uncertain post again', async () => {
    open(makePost({ id: 'p', status: 'failed', errorCode: 'uncertain', error: 'The app closed.' }))
    fireEvent.click(button('Post now'))
    expect(screen.getByText(/may already be on X/)).toBeTruthy()
    expect(posts.update).not.toHaveBeenCalled()
    fireEvent.click(button('Post anyway'))
    await waitFor(() => expect(posts.update).toHaveBeenCalled())
  })

  it.each(['posting', 'posted'] as const)('opens a %s post read-only', (status) => {
    open(
      makePost({
        id: 'p',
        status,
        text: 'On its way',
        postedAt: status === 'posted' ? '2026-09-26T08:00:00.000Z' : null,
        remoteId: status === 'posted' ? '99' : null
      })
    )
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('On its way')).toBeTruthy()
    expect(screen.queryByLabelText('Date')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Post now' })).toBeNull()
    expect(screen.getByText(/X does not allow editing/)).toBeTruthy()
    if (status === 'posted') {
      expect(screen.getByRole('link', { name: 'View on X' }).getAttribute('href')).toBe(
        'https://x.com/i/status/99'
      )
    }
    fireEvent.click(button('Close'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('PostEditor: posting as', () => {
  function withAccounts(accounts: XAccount[], activeAccountId = 'acme'): void {
    Object.assign(window.opencat, {
      auth: {
        status: vi.fn().mockResolvedValue({ accounts, activeAccountId, secureStorage: true }),
        onChanged: vi.fn(() => () => undefined)
      }
    })
  }

  const three = [
    xAccount('acme'),
    xAccount('mariasouza'),
    xAccount('sideproj', { needsReconnect: true })
  ]

  it('shows nothing with a single account', async () => {
    withAccounts([xAccount('acme')])
    open(null, { day: '2026-10-02' })
    await waitFor(() => expect(window.opencat.auth.status).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Posting as/ })).toBeNull()
  })

  it('schedules a new post from the account chosen on the chip', async () => {
    withAccounts(three)
    open(null, { day: '2026-10-02' })
    const chip = await screen.findByRole('button', { name: 'Posting as @acme' })
    fireEvent.click(chip)
    const choices = screen.getAllByRole('menuitemradio')
    expect(choices.map((c) => c.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    // A signed-out account can't post.
    expect((choices[2] as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('menuitemradio', { name: /@mariasouza/ }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('button', { name: 'Posting as @mariasouza' })).toBeTruthy()
    type(textBox(), 'From Maria')
    fireEvent.click(button('Schedule'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posts.create).toHaveBeenCalledWith({
      parts: [{ text: 'From Maria', media: [] }],
      scheduledAt: '2026-10-02T08:00:00.000Z',
      accountId: 'mariasouza'
    })
  })

  it("shows an existing post's own account, and moves it on save", async () => {
    withAccounts(three)
    open(makePost({ id: 'p', text: 'Hello', accountId: 'mariasouza' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Posting as @mariasouza' }))
    // Escape closes only the menu.
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Posting as @mariasouza' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /@acme/ }))
    fireEvent.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posts.update).toHaveBeenCalledWith(
      'p',
      expect.objectContaining({ accountId: 'acme', scheduledAt: '2026-09-28T09:00:00.000Z' })
    )
  })

  it('leaves the account alone when it is not changed', async () => {
    withAccounts(three)
    open(makePost({ id: 'p', text: 'Hello', accountId: 'mariasouza' }))
    await screen.findByRole('button', { name: 'Posting as @mariasouza' })
    type(textBox(), 'Hello again')
    fireEvent.click(button('Save'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(posts.update.mock.calls[0]![1]).not.toHaveProperty('accountId')
  })

  it('keeps a thread that is partly on X on its account', async () => {
    withAccounts(three)
    const failed = makePost({ id: 'p', status: 'failed', accountId: 'mariasouza' })
    open({
      ...failed,
      parts: [
        { ...failed.parts[0]!, remoteId: '1', remoteUrl: 'https://x.com/i/status/1' },
        {
          ...failed.parts[0]!,
          id: 'p-2',
          position: 1,
          text: 'two',
          remoteId: null,
          remoteUrl: null
        }
      ]
    })
    expect(await screen.findByText('@mariasouza')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Posting as/ })).toBeNull()
    expect(screen.getByTitle(/already on X/)).toBeTruthy()
  })

  it('shows the chip without a menu on a posted post', async () => {
    withAccounts(three)
    open(makePost({ id: 'p', status: 'posted', accountId: 'mariasouza' }))
    expect(await screen.findByText('@mariasouza')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Posting as/ })).toBeNull()
  })
})
