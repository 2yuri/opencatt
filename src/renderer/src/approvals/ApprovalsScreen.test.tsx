import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import type { Post, PostPart } from '@shared/api'
import { EditorProvider } from '../editor/EditorProvider'
import { makePost } from '../day/testPosts'
import { MediaViewerContext, type MediaViewerApi } from '../media/viewerContext'
import { stubSizes } from '../test/layout'
import { ApprovalsScreen } from './ApprovalsScreen'

// Europe/Lisbon (UTC+1). "Now" is Saturday 26 September 2026, 10:00 local.
const NOW = new Date('2026-09-26T09:00:00.000Z')
const pending = (fields: Partial<Post> & Pick<Post, 'id'>): Post =>
  makePost({ status: 'pending_approval', createdBy: 'agent', ...fields })
const part = (id: string, text: string, position: number): PostPart => ({
  id,
  position,
  text,
  media: [],
  remoteId: null,
  remoteUrl: null,
  postedAt: null
})

let waiting: Post[]
let rejected: Post[]
let approve: ReturnType<typeof vi.fn>
let reject: ReturnType<typeof vi.fn>
let remove: ReturnType<typeof vi.fn>
let viewer: MediaViewerApi
/** Who listens to auth.onChanged, to switch accounts as main would. */
const authListeners = new Set<() => void>()

function renderAt(path = '/approvals'): void {
  window.opencat = {
    posts: {
      listPending: vi.fn(() => Promise.resolve(waiting)),
      listByStatus: vi.fn(() => Promise.resolve(rejected)),
      approve,
      reject,
      delete: remove,
      onChanged: vi.fn(() => () => undefined)
    },
    media: { discard: vi.fn().mockResolvedValue(undefined) },
    auth: {
      onChanged: vi.fn((listener: () => void) => {
        authListeners.add(listener)
        return () => authListeners.delete(listener)
      })
    }
  } as unknown as typeof window.opencat
  render(
    <MemoryRouter initialEntries={[path]}>
      <MediaViewerContext.Provider value={viewer}>
        <EditorProvider>
          <Routes>
            <Route path="/approvals" element={<ApprovalsScreen />} />
          </Routes>
        </EditorProvider>
      </MediaViewerContext.Provider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  waiting = []
  rejected = []
  approve = vi.fn((id: string) => Promise.resolve(makePost({ id })))
  reject = vi.fn((id: string) => Promise.resolve(makePost({ id, status: 'rejected' })))
  remove = vi.fn().mockResolvedValue(undefined)
  viewer = { open: vi.fn(), close: vi.fn() }
  authListeners.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ApprovalsScreen', () => {
  it('groups what waits by day, with every thread part and who wrote it', async () => {
    waiting = [
      pending({ id: 'late', text: 'Good morning', scheduledAt: '2026-09-26T06:00:00.000Z' }),
      pending({
        id: 'thread',
        scheduledAt: '2026-09-29T08:00:00.000Z',
        parts: [part('a', 'We launch today.', 0), part('b', 'Here is how.', 1)]
      }),
      pending({ id: 'mcp', createdBy: 'mcp', scheduledAt: '2026-09-29T14:00:00.000Z' })
    ]
    renderAt()
    const today = await screen.findByRole('region', { name: 'Today Sat 26 Sep' })
    expect(within(today).getByText('Good morning')).toBeTruthy()
    const tuesday = screen.getByRole('region', { name: 'Tuesday 29 Sep · 2 posts' })
    expect(within(tuesday).getByText('We launch today.')).toBeTruthy()
    expect(within(tuesday).getByText('Here is how.')).toBeTruthy()
    expect(within(tuesday).getByText('via MCP')).toBeTruthy()
  })

  it('approves one post, and offers Reschedule instead for one more than an hour late', async () => {
    waiting = [
      pending({ id: 'late', scheduledAt: '2026-09-26T07:30:00.000Z' }),
      pending({ id: 'soon', scheduledAt: '2026-09-26T13:00:00.000Z' })
    ]
    renderAt()
    const [late, soon] = await screen.findAllByTestId('approval-row')
    expect(late!.textContent).toContain('Its time has passed')
    expect(within(late!).queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(within(late!).getByRole('button', { name: 'Reschedule' })).toBeTruthy()
    fireEvent.click(within(soon!).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(approve).toHaveBeenCalledWith('soon'))
    // Only one post can still be approved: no "Approve N".
    expect(screen.queryByRole('button', { name: /^Approve \d/ })).toBeNull()
  })

  it('approves everything approvable with Approve N and says which were refused', async () => {
    approve.mockImplementation((id: string) =>
      id === 'b'
        ? Promise.reject(
            new Error(
              "Error invoking remote method 'posts:approve': PostRuleError: This post was due more than an hour ago. Pick a new time, then approve it."
            )
          )
        : Promise.resolve(makePost({ id }))
    )
    waiting = [
      pending({ id: 'a', scheduledAt: '2026-09-29T08:00:00.000Z' }),
      pending({ id: 'b', scheduledAt: '2026-09-29T09:00:00.000Z' }),
      pending({ id: 'c', scheduledAt: '2026-09-30T09:00:00.000Z' }),
      pending({ id: 'late', scheduledAt: '2026-09-26T05:00:00.000Z' })
    ]
    renderAt()
    fireEvent.click(await screen.findByRole('button', { name: 'Approve 3' }))
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(3))
    expect(approve).not.toHaveBeenCalledWith('late')
    expect((await screen.findByRole('alert')).textContent).toBe(
      '2 approved. Not approved: Tue 10:00: This post was due more than an hour ago. Pick a new time, then approve it.'
    )
  })

  it('rejects with no confirm, since the post moves to the Rejected tab', async () => {
    waiting = [pending({ id: 'a', scheduledAt: '2026-09-29T08:00:00.000Z' })]
    renderAt()
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    await waitFor(() => expect(reject).toHaveBeenCalledWith('a'))
  })

  it('lists rejected posts read-only, deleted only after a confirm', async () => {
    rejected = [makePost({ id: 'r', text: 'Hot take', status: 'rejected', createdBy: 'agent' })]
    renderAt('/approvals?tab=rejected')
    const row = await screen.findByTestId('approval-row')
    expect(row.textContent).toContain('Hot take')
    expect(within(row).queryByRole('button', { name: 'Approve' })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    expect(row.textContent).toContain('Delete this post for good?')
    fireEvent.click(within(row).getByRole('button', { name: 'Keep' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith('r'))
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('says so when nothing waits, and counts both tabs', async () => {
    rejected = [makePost({ id: 'r', status: 'rejected' })]
    renderAt()
    expect(await screen.findByText(/Nothing waiting/)).toBeTruthy()
    const tab = screen.getByRole('tab', { name: /Rejected/ })
    await waitFor(() => expect(tab.textContent).toBe('Rejected1'))
    expect(tab.getAttribute('aria-selected')).toBe('false')
  })
})

describe('ApprovalsScreen toolbar', () => {
  const mainWidth = (width: number): void =>
    stubSizes((el) => (el.tagName === 'MAIN' ? { width, height: 580 } : undefined))

  it('shows the hint line on a wide main card', async () => {
    mainWidth(1000)
    renderAt()
    expect(
      await screen.findByText('Nothing the agent writes goes out until you approve it.')
    ).toBeTruthy()
  })

  it('drops the hint line on a narrow main card, keeping the tabs and Approve N', async () => {
    waiting = [
      pending({ id: 'a', scheduledAt: '2026-09-29T08:00:00.000Z' }),
      pending({ id: 'b', scheduledAt: '2026-09-29T11:30:00.000Z' })
    ]
    mainWidth(540)
    renderAt()
    expect(await screen.findByRole('button', { name: /Approve 2/ })).toBeTruthy()
    expect(screen.getByRole('tab', { name: /Waiting/ })).toBeTruthy()
    expect(screen.queryByTestId('approvals-hint')).toBeNull()
  })
})

describe('ApprovalsScreen per X account', () => {
  it("lists the new active account's waiting posts when the account changes", async () => {
    waiting = [pending({ id: 'a', text: 'From Acme', scheduledAt: '2026-09-29T08:00:00.000Z' })]
    renderAt()
    expect(await screen.findByText('From Acme')).toBeTruthy()
    waiting = [pending({ id: 'm', text: 'From Maria', scheduledAt: '2026-09-29T08:00:00.000Z' })]
    act(() => authListeners.forEach((l) => l()))
    expect(await screen.findByText('From Maria')).toBeTruthy()
    expect(screen.queryByText('From Acme')).toBeNull()
  })
})

describe('ApprovalsScreen media (OP-88)', () => {
  it("opens the viewer at the clicked thumbnail, on all of the post's media", async () => {
    const file = (id: string) => ({
      id,
      kind: 'image' as const,
      mime: 'image/png',
      bytes: 1024,
      width: 1200,
      height: 675,
      durationMs: null,
      alt: null,
      url: `opencat-media://media/${id}.png`
    })
    waiting = [
      pending({
        id: 'a',
        scheduledAt: '2026-09-29T08:00:00.000Z',
        parts: [
          { ...part('p1', 'One', 0), media: [file('x'), file('y')] },
          { ...part('p2', 'Two', 1), media: [file('z')] }
        ]
      })
    ]
    renderAt()
    const row = await screen.findByTestId('approval-row')
    const thumbs = within(row).getAllByRole('button', { name: 'View image' })
    expect(thumbs).toHaveLength(3)
    fireEvent.click(thumbs[2]!)
    expect(viewer.open).toHaveBeenCalledWith(
      [
        expect.objectContaining({ url: 'opencat-media://media/x.png', partLabel: 'Part 1' }),
        expect.objectContaining({ url: 'opencat-media://media/y.png', partLabel: 'Part 1' }),
        expect.objectContaining({ url: 'opencat-media://media/z.png', partLabel: 'Part 2' })
      ],
      2
    )
  })
})
