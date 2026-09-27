import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { EditorProvider } from '../editor/EditorProvider'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { Post, PostsChangedEvent } from '@shared/api'
import { stubSizes } from '../test/layout'
import { DayBoardScreen } from './DayBoardScreen'
import { makePost } from './testPosts'

let listByDay: ReturnType<typeof vi.fn>
let changed: ((event: PostsChangedEvent) => void) | null

function Where(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.search}</output>
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <EditorProvider>
        <Routes>
          <Route path="/" element={<p>calendar</p>} />
          <Route path="/day/:date" element={<DayBoardScreen />} />
          <Route path="/approvals" element={<p>approvals</p>} />
        </Routes>
        <Where />
      </EditorProvider>
    </MemoryRouter>
  )
}

const where = (): string => screen.getByTestId('where').textContent ?? ''
const column = (name: string): HTMLElement => screen.getByRole('region', { name })

// Local times in Europe/Lisbon (WEST, UTC+1) on 28 September 2026.
const day: Post[] = [
  makePost({
    id: 'p1',
    text: 'Shipped it',
    status: 'posted',
    scheduledAt: '2026-09-28T07:00:00.000Z',
    postedAt: '2026-09-28T07:00:04.000Z',
    remoteId: '1840'
  }),
  makePost({ id: 's2', text: 'Afternoon thread', scheduledAt: '2026-09-28T14:30:00.000Z' }),
  makePost({
    id: 'f1',
    text: 'Good morning',
    status: 'failed',
    scheduledAt: '2026-09-28T08:00:00.000Z',
    error: 'Missed: the app was closed at 09:00.',
    errorCode: 'missed'
  }),
  makePost({
    id: 'g1',
    text: 'Going out now',
    status: 'posting',
    scheduledAt: '2026-09-28T11:00:00.000Z'
  })
]

beforeEach(() => {
  changed = null
  listByDay = vi.fn().mockResolvedValue(day)
  window.opencat = {
    posts: {
      listByDay,
      onChanged: vi.fn((listener: (event: PostsChangedEvent) => void) => {
        changed = listener
        return () => {
          changed = null
        }
      })
    }
  } as unknown as typeof window.opencat
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('DayBoardScreen', () => {
  it('keeps posts waiting for approval off the board and links to Approvals', async () => {
    listByDay.mockResolvedValue([
      makePost({ id: 'a1', text: 'Agent draft', status: 'pending_approval', createdBy: 'agent' }),
      makePost({ id: 's1', text: 'Mine', scheduledAt: '2026-09-28T16:00:00.000Z' })
    ])
    renderAt('/day/2026-09-28')
    await screen.findByText('Mine')
    expect(screen.queryByText('Agent draft')).toBeNull()
    expect(screen.getByText(/1 post for this day is waiting for your approval/)).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Review in Approvals' }))
    expect(where()).toBe('/approvals')
  })

  it('loads the day and puts each post in its column, by time', async () => {
    renderAt('/day/2026-09-28')
    expect(screen.getByRole('heading', { name: 'Monday 28 September 2026' })).toBeTruthy()
    expect(listByDay).toHaveBeenCalledWith('2026-09-28')

    await screen.findByText('Shipped it')
    const scheduled = within(column('Scheduled')).getAllByTestId('post-card')
    expect(scheduled.map((card) => card.textContent)).toEqual([
      expect.stringContaining('09:00Failed'),
      expect.stringContaining('12:00'),
      expect.stringContaining('15:30')
    ])
    expect(within(column('Posted')).getAllByTestId('post-card')).toHaveLength(1)
  })

  it('flags a failed post with its error', async () => {
    renderAt('/day/2026-09-28')
    const error = await screen.findByRole('alert')
    expect(error.textContent).toBe('Missed: the app was closed at 09:00.')
    expect(error.closest('article')?.className).toContain('card-failed')
  })

  it('shows a posting post as in progress', async () => {
    renderAt('/day/2026-09-28')
    const posting = await screen.findByText('Posting…')
    expect(posting.closest('article')?.textContent).toContain('Going out now')
  })

  it('links a posted post to X in a new window, which main sends to the browser', async () => {
    renderAt('/day/2026-09-28')
    const link = await screen.findByRole('link', { name: 'View on X ↗' })
    expect(link.getAttribute('href')).toBe('https://x.com/i/status/1840')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(screen.getAllByRole('link', { name: 'View on X ↗' })).toHaveLength(1)
  })

  it('says so when a column is empty', async () => {
    listByDay.mockResolvedValue([])
    renderAt('/day/2026-09-29')
    expect(await screen.findByText('Nothing scheduled for this day.')).toBeTruthy()
    expect(screen.getByText('Nothing posted on this day yet.')).toBeTruthy()
  })

  it('updates when a post changes', async () => {
    renderAt('/day/2026-09-28')
    await screen.findByText('Going out now')
    listByDay.mockResolvedValue([
      { ...day[3], status: 'posted', postedAt: '2026-09-28T10:00:02.000Z', remoteId: '1841' }
    ])
    await act(async () => changed?.({ ids: ['g1'] }))
    await waitFor(() => expect(within(column('Posted')).getByText('Going out now')).toBeTruthy())
    expect(within(column('Scheduled')).getByText('Nothing scheduled for this day.')).toBeTruthy()
  })

  it('moves to the previous and next day, and back to the calendar', async () => {
    renderAt('/day/2026-10-01')
    fireEvent.click(screen.getByRole('link', { name: 'Previous day' }))
    expect(where()).toBe('/day/2026-09-30')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(where()).toBe('/day/2026-10-02')
    await waitFor(() => expect(listByDay).toHaveBeenLastCalledWith('2026-10-02'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(where()).toBe('/?view=month&date=2026-10-02')
  })

  it('crosses a month and a DST change day by day', () => {
    renderAt('/day/2026-10-25')
    fireEvent.click(screen.getByRole('link', { name: 'Next day' }))
    expect(where()).toBe('/day/2026-10-26')
  })

  it('sends an invalid date back to the calendar', () => {
    renderAt('/day/2026-02-30')
    expect(where()).toBe('/')
  })
})

describe('DayBoardScreen with the editor', () => {
  it('opens a new post on this day, and Esc closes the editor without leaving the board', async () => {
    renderAt('/day/2099-01-05')
    fireEvent.click(screen.getByRole('button', { name: 'New post' }))
    const dialog = screen.getByRole('dialog', { name: 'New post' })
    expect(within(dialog).getByLabelText<HTMLInputElement>('Date').value).toBe('2099-01-05')
    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(where()).toBe('/day/2099-01-05')
  })

  it('opens a card in the editor', async () => {
    renderAt('/day/2026-09-28')
    fireEvent.click(await screen.findByRole('button', { name: 'Edit post at 15:30' }))
    expect(screen.getByRole('dialog', { name: 'Edit post' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Post text' })).toHaveProperty(
      'value',
      'Afternoon thread'
    )
  })
})

describe('DayBoardScreen toolbar', () => {
  it('turns New post into a "+" icon on a narrow main card', () => {
    stubSizes((el) => (el.tagName === 'MAIN' ? { width: 540, height: 580 } : undefined))
    renderAt('/day/2099-01-05')
    const newPost = screen.getByRole('button', { name: 'New post' })
    expect(newPost.textContent).toBe('')
    expect(newPost.className).toContain('size-[32px]')
    fireEvent.click(newPost)
    expect(screen.getByRole('dialog', { name: 'New post' })).toBeTruthy()
  })

  it('keeps the labelled New post on a wide main card', () => {
    stubSizes((el) => (el.tagName === 'MAIN' ? { width: 1000, height: 800 } : undefined))
    renderAt('/day/2099-01-05')
    expect(screen.getByRole('button', { name: 'New post' }).textContent).toBe('New post')
  })
})

describe('DayBoardScreen per X account', () => {
  it("loads the new active account's posts for the day when the account changes", async () => {
    const authListeners = new Set<() => void>()
    Object.assign(window.opencat, {
      auth: {
        status: vi
          .fn()
          .mockResolvedValue({ accounts: [], activeAccountId: 'a', secureStorage: true }),
        onChanged: vi.fn((listener: () => void) => {
          authListeners.add(listener)
          return () => authListeners.delete(listener)
        })
      }
    })
    listByDay.mockResolvedValue([makePost({ id: 'a1', text: 'From Acme' })])
    renderAt('/day/2026-09-28')
    expect(await screen.findByText('From Acme')).toBeTruthy()
    listByDay.mockResolvedValue([makePost({ id: 'm1', text: 'From Maria' })])
    act(() => authListeners.forEach((l) => l()))
    expect(await screen.findByText('From Maria')).toBeTruthy()
    expect(screen.queryByText('From Acme')).toBeNull()
  })
})
