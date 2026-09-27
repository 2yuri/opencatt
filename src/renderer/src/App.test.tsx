import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EditorProvider } from './editor/EditorProvider'
import { MemoryRouter } from 'react-router'
import { AppRoutes, Shell } from './App'
import { chatMessage, fakeApi, post, xAccount } from './test/fakeApi'

afterEach(() => {
  cleanup()
})

function renderAt(path: string): void {
  window.opencat = {
    locale: { weekStart: vi.fn().mockResolvedValue(1) },
    settings: { get: vi.fn().mockResolvedValue(null), set: vi.fn() },
    posts: {
      listRange: vi.fn().mockResolvedValue({}),
      pending: vi.fn().mockResolvedValue({ count: 0, first: null }),
      listByDay: vi.fn().mockResolvedValue([]),
      onChanged: vi.fn(() => () => {})
    }
  } as unknown as typeof window.opencat
  render(
    <MemoryRouter initialEntries={[path]}>
      <EditorProvider>
        <AppRoutes />
      </EditorProvider>
    </MemoryRouter>
  )
}

describe('AppRoutes', () => {
  it('opens on the calendar', () => {
    renderAt('/?view=month&date=2026-09-26')
    expect(screen.getByRole('heading', { name: 'September 2026' })).toBeTruthy()
  })

  it('opens a day at /day/<date>', () => {
    renderAt('/day/2026-09-28')
    expect(screen.getByRole('heading', { name: 'Monday 28 September 2026' })).toBeTruthy()
  })

  it('sends an invalid day back to the calendar', () => {
    renderAt('/day/2026-02-30')
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy()
  })

  it('sends unknown paths to the calendar', () => {
    renderAt('/nowhere')
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy()
  })

  it('opens a post waiting for approval in Approvals', async () => {
    const fake = fakeApi([
      chatMessage('tool', JSON.stringify({ kind: 'posts', action: 'created', postIds: ['p1'] }))
    ])
    const draft = post({
      id: 'p1',
      text: 'Agent draft',
      scheduledAt: '2099-09-28T09:00:00',
      status: 'pending_approval'
    })
    fake.posts.set('p1', draft)
    Object.assign(fake.api.posts, {
      listRange: vi.fn().mockResolvedValue({}),
      pending: vi.fn().mockResolvedValue({ count: 1, first: '2099-09-28' }),
      listPending: vi.fn().mockResolvedValue([draft]),
      listByStatus: vi.fn().mockResolvedValue([])
    })
    window.opencat = fake.api
    render(
      <MemoryRouter initialEntries={['/?view=month&date=2026-09-26']}>
        <EditorProvider>
          <Shell />
        </EditorProvider>
      </MemoryRouter>
    )
    const card = await screen.findByRole('article', { name: /Post for/ })
    fireEvent.click(within(card).getByRole('button', { name: 'Open in Approvals' }))
    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeTruthy()
    const row = await screen.findByTestId('approval-row')
    expect(row.dataset['selected']).toBe('true')
  })
})

describe('Shell', () => {
  it('opens the day of a post clicked in the chat', async () => {
    const fake = fakeApi([
      chatMessage('tool', JSON.stringify({ kind: 'posts', action: 'created', postIds: ['p1'] }))
    ])
    fake.posts.set('p1', post({ id: 'p1', text: 'Launch!', scheduledAt: '2026-09-28T09:00:00' }))
    Object.assign(fake.api.posts, {
      listRange: vi.fn().mockResolvedValue({}),
      pending: vi.fn().mockResolvedValue({ count: 0, first: null }),
      listByDay: vi.fn().mockResolvedValue([])
    })
    window.opencat = fake.api
    render(
      <MemoryRouter initialEntries={['/?view=month&date=2026-09-26']}>
        <EditorProvider>
          <Shell />
        </EditorProvider>
      </MemoryRouter>
    )

    const card = await screen.findByRole('article', { name: /Post for/ })
    fireEvent.click(within(card).getByRole('button', { name: 'Open day' }))
    expect(await screen.findByRole('heading', { name: 'Monday 28 September 2026' })).toBeTruthy()
  })

  it('opens the Approvals page for a post the agent wrote that waits for approval', async () => {
    const fake = fakeApi([
      chatMessage('tool', JSON.stringify({ kind: 'posts', action: 'created', postIds: ['p1'] }))
    ])
    const waiting = post({
      id: 'p1',
      text: 'Launch!',
      scheduledAt: '2026-09-28T09:00:00',
      status: 'pending_approval',
      createdBy: 'agent'
    })
    fake.posts.set('p1', waiting)
    Object.assign(fake.api.posts, {
      listRange: vi.fn().mockResolvedValue({}),
      pending: vi.fn().mockResolvedValue({ count: 1, first: '2026-09-28' }),
      listByDay: vi.fn().mockResolvedValue([]),
      listPending: vi.fn().mockResolvedValue([waiting]),
      listByStatus: vi.fn().mockResolvedValue([])
    })
    window.opencat = fake.api
    render(
      <MemoryRouter initialEntries={['/?view=month&date=2026-09-26']}>
        <EditorProvider>
          <Shell />
        </EditorProvider>
      </MemoryRouter>
    )

    const card = await screen.findByRole('article', { name: /Post for/ })
    fireEvent.click(within(card).getByRole('button', { name: 'Open in Approvals' }))
    expect(await screen.findByTestId('approval-row')).toBeTruthy()
  })

  it("opens Settings on the active account's voice from the agent panel's header", async () => {
    const fake = fakeApi()
    fake.authStatus.accounts = [xAccount('acme')]
    fake.authStatus.activeAccountId = 'acme'
    Object.assign(fake.api.posts, {
      listRange: vi.fn().mockResolvedValue({}),
      pending: vi.fn().mockResolvedValue({ count: 0, first: null }),
      listByDay: vi.fn().mockResolvedValue([])
    })
    window.opencat = fake.api
    render(
      <MemoryRouter initialEntries={['/?view=month&date=2026-09-26']}>
        <EditorProvider>
          <Shell />
        </EditorProvider>
      </MemoryRouter>
    )

    const voice = await screen.findByRole('button', { name: 'Voice settings' })
    expect(voice.getAttribute('title')).toBe('Voice settings')
    fireEvent.click(voice)
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeTruthy()
    expect(await screen.findByText('for @acme')).toBeTruthy()
    expect(document.getElementById('voice')).toBeTruthy()
  })
})
