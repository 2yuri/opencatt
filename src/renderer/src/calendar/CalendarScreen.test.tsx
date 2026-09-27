import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EditorProvider } from '../editor/EditorProvider'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { Post, PostStatus, PostsChangedEvent } from '@shared/api'
import { makePost } from '../day/testPosts'
import { stubSizes } from '../test/layout'
import { CalendarScreen } from './CalendarScreen'

let seq = 0
/** Posts for one local day (Europe/Lisbon, UTC+1): each entry is [status, "HH:MM", text]. */
const onDay = (date: string, ...posts: [PostStatus, string, string][]): Post[] =>
  posts.map(([status, time, text]) =>
    makePost({
      id: `p${++seq}`,
      status,
      text,
      scheduledAt: new Date(`${date}T${time}:00+01:00`).toISOString()
    })
  )

let listRange: ReturnType<typeof vi.fn>
let pending: ReturnType<typeof vi.fn>
const listeners = new Set<(event: PostsChangedEvent) => void>()
let changed: ((event: PostsChangedEvent) => void) | null
let weekStart: ReturnType<typeof vi.fn>
let settings: Map<string, unknown>

function Where(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.search}</output>
}

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <EditorProvider>
        <Routes>
          <Route path="/" element={<CalendarScreen />} />
          <Route path="/day/:date" element={<p>day board</p>} />
        </Routes>
        <Where />
      </EditorProvider>
    </MemoryRouter>
  )
}

const where = (): string => screen.getByTestId('where').textContent ?? ''
const cell = (name: RegExp): HTMLElement => screen.getByRole('button', { name })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 26, 10, 0))
  changed = null
  listeners.clear()
  pending = vi.fn().mockResolvedValue({ count: 0, first: null })
  listRange = vi.fn().mockResolvedValue({
    '2026-09-24': onDay(
      '2026-09-24',
      ['scheduled', '09:00', 'Morning post'],
      ['posting', '11:00', 'Going out now'],
      ['scheduled', '15:30', 'Afternoon post']
    ),
    '2026-09-25': onDay(
      '2026-09-25',
      ['posted', '08:00', 'One'],
      ['posted', '09:00', 'Two'],
      ['failed', '10:00', 'Broke'],
      ['posted', '11:00', 'Three'],
      ['posted', '12:00', 'Four']
    )
  })
  weekStart = vi.fn().mockResolvedValue(1)
  settings = new Map()
  window.opencat = {
    locale: { weekStart },
    settings: {
      get: vi.fn((key: string) => Promise.resolve(settings.get(key) ?? null)),
      set: vi.fn((key: string, value: unknown) => {
        settings.set(key, value)
        return Promise.resolve()
      })
    },
    posts: {
      listRange,
      pending,
      onChanged: vi.fn((listener: (event: PostsChangedEvent) => void) => {
        listeners.add(listener)
        changed = (event) => listeners.forEach((l) => l(event))
        return () => listeners.delete(listener)
      })
    }
  } as unknown as typeof window.opencat
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CalendarScreen', () => {
  it('opens on the current month and asks for the six weeks it shows', async () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeTruthy()
    await waitFor(() => expect(listRange).toHaveBeenCalledWith('2026-08-31', '2026-10-11'))
  })

  it('shows each post as a chip with its time and status, and +N more past three', async () => {
    renderAt('/')
    const morning = await screen.findByRole('button', { name: /09:00Morning post/ })
    expect(morning.dataset['status']).toBe('scheduled')
    // Posting still counts as scheduled until X answers.
    expect(cell(/^Thursday 24 September 2026, 3 scheduled$/)).toBeTruthy()
    expect(cell(/^Friday 25 September 2026, 4 posted, 1 failed$/)).toBeTruthy()
    const friday = cell(/^Friday 25 September/).closest('[data-testid="day-cell"]') as HTMLElement
    expect(friday.querySelectorAll('[data-testid="post-chip"]')).toHaveLength(3)
    expect(friday.textContent).toContain('+2 more')
  })

  it('opens a post from its chip, not the day', async () => {
    renderAt('/')
    fireEvent.click(await screen.findByRole('button', { name: /09:00Morning post/ }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(where()).toBe('/')
  })

  it('marks today and dims days outside the month', () => {
    renderAt('/')
    expect(cell(/^Saturday 26 September/).getAttribute('aria-current')).toBe('date')
    const outside = cell(/^Monday 31 August/).closest('[data-testid="day-cell"]') as HTMLElement
    expect(outside.dataset['outside']).toBe('true')
  })

  it('moves between months with the buttons and comes back with Today', () => {
    renderAt('/')
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('heading', { name: 'August 2026' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeTruthy()
    expect(where()).toBe('/?view=month&date=2026-09-26')
  })

  it('moves with the arrow keys and T', () => {
    renderAt('/?view=week&date=2026-09-26')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(screen.getByRole('heading', { name: '28 Sep – 4 Oct 2026' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByRole('heading', { name: '14 – 20 Sep 2026' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 't' })
    expect(screen.getByRole('heading', { name: '21 – 27 Sep 2026' })).toBeTruthy()
  })

  it('switches to the week view and keeps it in the URL', async () => {
    renderAt('/?date=2026-09-26')
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    expect(where()).toBe('/?view=week&date=2026-09-26')
    expect(screen.getAllByRole('button', { name: /September 2026/ })).toHaveLength(7)
    await waitFor(() => expect(listRange).toHaveBeenLastCalledWith('2026-09-21', '2026-09-27'))
  })

  it('opens the day board when a day is clicked', () => {
    renderAt('/')
    fireEvent.click(cell(/^Monday 28 September/))
    expect(where()).toBe('/day/2026-09-28')
  })

  it('shows posts to approve per day, and a badge that opens Approvals', async () => {
    listRange.mockResolvedValue({
      '2026-09-29': onDay(
        '2026-09-29',
        ['pending_approval', '09:00', 'a'],
        ['pending_approval', '10:00', 'b'],
        ['pending_approval', '11:00', 'c'],
        ['scheduled', '12:00', 'd']
      )
    })
    pending.mockResolvedValue({ count: 4, first: '2026-09-29' })
    renderAt('/')
    await screen.findAllByTestId('post-chip')
    expect(cell(/^Tuesday 29 September 2026, 3 to approve, 1 scheduled$/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: '4 to approve' }))
    expect(where()).toBe('/approvals')
  })

  it('hides the badge when nothing waits, and shows it once something does', async () => {
    renderAt('/')
    await waitFor(() => expect(pending).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /to approve$/ })).toBeNull()
    pending.mockResolvedValue({ count: 1, first: '2026-09-30' })
    act(() => changed?.({ ids: ['x'] }))
    expect(await screen.findByRole('button', { name: '1 to approve' })).toBeTruthy()
  })

  it('falls back to today for a bad date in the URL', () => {
    renderAt('/?view=month&date=2026-02-31')
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeTruthy()
  })

  it('loads the posts again when a post changes', async () => {
    renderAt('/')
    await waitFor(() => expect(listRange).toHaveBeenCalledTimes(1))
    listRange.mockResolvedValue({ '2026-09-24': onDay('2026-09-24', ['posted', '09:00', 'Fresh']) })
    await act(async () => changed?.({ ids: ['a'] }))
    expect(await screen.findByRole('button', { name: /09:00Fresh/ })).toBeTruthy()
  })
})

describe('CalendarScreen week start', () => {
  const firstCell = (): string =>
    screen.getAllByRole('button', { name: /2026$/ })[0].getAttribute('aria-label') ?? ''

  it('starts on Sunday when the system region does', async () => {
    weekStart.mockResolvedValue(0)
    renderAt('/?view=month&date=2026-09-26')
    await waitFor(() => expect(firstCell()).toBe('Sunday 30 August 2026'))
    await waitFor(() => expect(listRange).toHaveBeenLastCalledWith('2026-08-30', '2026-10-10'))
  })

  it('starts on Saturday for a Saturday region', async () => {
    weekStart.mockResolvedValue(6)
    renderAt('/?view=week&date=2026-09-23')
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '19 – 25 Sep 2026' })).toBeTruthy()
    )
  })

  it('leaves choosing the first day to the Settings screen', async () => {
    renderAt('/?view=month&date=2026-09-26')
    await waitFor(() => expect(weekStart).toHaveBeenCalled())
    expect(screen.queryByLabelText('Week starts on')).toBeNull()
  })

  it('uses a saved choice over the system', async () => {
    weekStart.mockResolvedValue(1)
    settings.set('calendar.weekStartsOn', 'sunday')
    renderAt('/?view=month&date=2026-09-26')
    await waitFor(() => expect(firstCell()).toBe('Sunday 30 August 2026'))
  })

  it('stays on Monday if the locale cannot be read', async () => {
    weekStart.mockRejectedValue(new Error('no locale'))
    renderAt('/?view=month&date=2026-09-26')
    await waitFor(() => expect(weekStart).toHaveBeenCalled())
    expect(firstCell()).toBe('Monday 31 August 2026')
  })

  it('fits fewer chips and a "+N more" into short cells', async () => {
    stubSizes((el) => (el.dataset['testid'] === 'day-cell' ? { width: 77, height: 80 } : undefined))
    renderAt('/')
    await screen.findByRole('button', { name: /09:00Morning post/ })
    const friday = cell(/^Friday 25 September/).closest('[data-testid="day-cell"]') as HTMLElement
    expect(friday.querySelectorAll('[data-testid="post-chip"]')).toHaveLength(1)
    expect(friday.textContent).toContain('+4 more')
    const thursday = cell(/^Thursday 24 September/).closest(
      '[data-testid="day-cell"]'
    ) as HTMLElement
    expect(thursday.querySelectorAll('[data-testid="post-chip"]')).toHaveLength(1)
    expect(thursday.textContent).toContain('+2 more')
  })
})

describe('CalendarScreen toolbar', () => {
  const mainWidth = (width: number): void =>
    stubSizes((el) => (el.tagName === 'MAIN' ? { width, height: 580 } : undefined))

  it('shows the full labels on a wide main card', async () => {
    pending.mockResolvedValue({ count: 4, first: '2026-09-29' })
    mainWidth(1200)
    renderAt('/')
    const badge = await screen.findByRole('button', { name: '4 to approve' })
    expect(badge.textContent).toBe('4 to approve')
    expect(screen.getByRole('button', { name: 'New post' }).textContent).toBe('New post')
  })

  it('goes compact on a narrow main card: count-only badge and an icon New post', async () => {
    pending.mockResolvedValue({ count: 4, first: '2026-09-29' })
    mainWidth(700)
    renderAt('/')
    const badge = await screen.findByRole('button', { name: '4 to approve' })
    expect(badge.textContent).toBe('4')
    const newPost = screen.getByRole('button', { name: 'New post' })
    expect(newPost.textContent).toBe('')
    expect(newPost.className).toContain('size-[32px]')
    expect(screen.getByRole('heading', { name: 'September 2026' }).className).toContain('truncate')
    fireEvent.click(newPost)
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('shortens the month on the narrowest main card', async () => {
    mainWidth(540)
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Sep 2026' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New post' }).textContent).toBe('')
  })
})

describe('CalendarScreen per X account', () => {
  it("shows the new active account's posts and count when the account changes", async () => {
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
    renderAt('/')
    expect(await screen.findByRole('button', { name: /09:00Morning post/ })).toBeTruthy()

    listRange.mockResolvedValue({
      '2026-09-24': onDay('2026-09-24', ['scheduled', '13:00', 'Other account'])
    })
    pending.mockResolvedValue({ count: 2, first: '2026-09-29' })
    act(() => authListeners.forEach((l) => l()))
    expect(await screen.findByRole('button', { name: /13:00Other account/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /09:00Morning post/ })).toBeNull()
    expect(await screen.findByLabelText('2 to approve')).toBeTruthy()
  })
})
