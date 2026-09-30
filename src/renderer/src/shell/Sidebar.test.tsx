import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { AuthError } from '@shared/authErrors'
import { fakeApi, xAccount, type FakeApi } from '../test/fakeApi'
import { stubWindowWidth } from '../test/layout'
import { SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH } from './layout'
import { Sidebar } from './Sidebar'

function Where(): React.JSX.Element {
  return <output data-testid="where">{useLocation().pathname}</output>
}

function renderSidebar(pending: { count: number; first: string | null }): void {
  window.opencat = {
    posts: {
      pending: vi.fn().mockResolvedValue(pending),
      onChanged: vi.fn(() => () => undefined)
    }
  } as unknown as typeof window.opencat
  render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar connected />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
}

afterEach(() => cleanup())

describe('Sidebar', () => {
  it('marks the current screen and shows how many posts wait for approval', async () => {
    renderSidebar({ count: 4, first: '2026-09-29' })
    expect(screen.getByRole('link', { name: 'Calendar' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: /Approvals/ }).getAttribute('aria-current')).toBeNull()
    expect(await screen.findByLabelText('4 waiting')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: /Approvals/ }))
    expect(screen.getByTestId('where').textContent).toBe('/approvals')
  })

  it('lists Dashboard first and shows the current screen in the accent colour, no pill', () => {
    renderSidebar({ count: 0, first: null })
    const links = screen.getAllByRole('link').map((l) => l.textContent)
    expect(links.slice(0, 3)).toEqual(['Dashboard', 'Calendar', 'Approvals'])
    const calendar = screen.getByRole('link', { name: 'Calendar' })
    expect(calendar.className).toContain('text-ds-accent-text')
    expect(calendar.className).not.toContain('bg-ds-raised')
    expect(screen.getByRole('link', { name: 'Dashboard' }).className).toContain('text-ds-text-2')
  })

  it('shows no badge when nothing waits', async () => {
    renderSidebar({ count: 0, first: null })
    expect(await screen.findByRole('link', { name: 'Approvals' })).toBeTruthy()
    expect(screen.queryByLabelText(/waiting/)).toBeNull()
  })

  it('opens the Settings screen and marks it as current', () => {
    renderSidebar({ count: 0, first: null })
    fireEvent.click(screen.getByRole('link', { name: 'Settings' }))
    expect(screen.getByTestId('where').textContent).toBe('/settings')
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('aria-current')).toBe('page')
  })

  it('opens Integrations, listed just above Settings', () => {
    renderSidebar({ count: 0, first: null })
    const links = screen.getAllByRole('link').map((l) => l.textContent)
    expect(links.indexOf('Integrations')).toBe(links.indexOf('Settings') - 1)
    fireEvent.click(screen.getByRole('link', { name: 'Integrations' }))
    expect(screen.getByTestId('where').textContent).toBe('/integrations')
    expect(screen.getByRole('link', { name: 'Integrations' }).getAttribute('aria-current')).toBe(
      'page'
    )
  })
})

describe('Sidebar on a narrow window', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps its labels at 1100px and wider', async () => {
    stubWindowWidth(1100)
    renderSidebar({ count: 4, first: '2026-09-29' })
    const nav = screen.getByRole('navigation', { name: 'OpenCatt' })
    expect(nav.style.width).toBe(`${SIDEBAR_WIDTH}px`)
    expect(nav.dataset['rail']).toBeUndefined()
    expect(screen.getByText('OpenCatt')).toBeTruthy()
    expect(await screen.findByLabelText('4 waiting')).toBeTruthy()
  })

  it('turns into a 64px icon rail below 1100px, with tooltips and the count on the icon', async () => {
    stubWindowWidth(1099)
    renderSidebar({ count: 4, first: '2026-09-29' })
    const nav = screen.getByRole('navigation', { name: 'OpenCatt' })
    expect(nav.style.width).toBe(`${SIDEBAR_RAIL_WIDTH}px`)
    expect(nav.dataset['rail']).toBe('true')
    // Logo only, no name; labels live on as aria-labels and native tooltips.
    expect(screen.queryByText('OpenCatt')).toBeNull()
    expect(screen.queryByText('Calendar')).toBeNull()
    const calendar = screen.getByRole('link', { name: 'Calendar' })
    expect(calendar.getAttribute('title')).toBe('Calendar')
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('title')).toBe('Settings')
    expect(screen.queryByText('Integrations')).toBeNull()
    expect(screen.getByRole('link', { name: 'Integrations' }).getAttribute('title')).toBe(
      'Integrations'
    )
    const approvals = await screen.findByRole('link', { name: 'Approvals, 4 waiting' })
    expect(approvals.getAttribute('title')).toBe('Approvals')
    const badge = screen.getByTestId('rail-badge')
    expect(badge.textContent).toBe('4')
    expect(badge.className).toContain('left-[19px]')
    expect(badge.className).toContain('h-[15px]')
    // The account row shows the avatar only.
    expect(screen.queryByText('X account')).toBeNull()
    expect(screen.getByText('X account: Your X app is set up')).toBeTruthy()
  })
})

/** Three accounts, Acme active, with posts waiting in Acme (4) and Maria (2). */
function renderWithAccounts(): FakeApi {
  const fake = fakeApi()
  Object.assign(fake.authStatus, {
    accounts: [
      xAccount('acme', { name: 'Acme' }),
      xAccount('mariasouza', { name: 'Maria Souza' }),
      xAccount('sideproj', { name: 'Side project', needsReconnect: true })
    ],
    activeAccountId: 'acme'
  })
  Object.assign(fake.pendingByAccount, { acme: 4, mariasouza: 2 })
  window.opencat = fake.api
  render(
    <MemoryRouter initialEntries={['/']}>
      <Sidebar connected />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
  return fake
}

const switcher = (): Promise<HTMLElement> =>
  screen.findByRole('button', { name: /Account switcher/ })

describe('Sidebar account switcher', () => {
  it('shows the active account and how many posts wait in the others', async () => {
    renderWithAccounts()
    const button = await switcher()
    expect(within(button).getByText('Acme')).toBeTruthy()
    expect(within(button).getByText('@acme')).toBeTruthy()
    expect(await within(button).findByLabelText('2 waiting in other accounts')).toBeTruthy()
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows no elsewhere count when only the active account has posts waiting', async () => {
    const fake = fakeApi()
    Object.assign(fake.authStatus, { accounts: [xAccount('acme')], activeAccountId: 'acme' })
    fake.pendingByAccount['acme'] = 3
    window.opencat = fake.api
    render(
      <MemoryRouter>
        <Sidebar connected />
      </MemoryRouter>
    )
    await switcher()
    await waitFor(() => expect(fake.api.posts.pendingByAccount).toHaveBeenCalled())
    expect(screen.queryByLabelText(/waiting in other accounts/)).toBeNull()
  })

  it('lists every account with its waiting count, the active one checked', async () => {
    renderWithAccounts()
    fireEvent.click(await switcher())
    const menu = screen.getByRole('menu', { name: 'X accounts' })
    const rows = within(menu).getAllByRole('menuitemradio')
    expect(rows.map((r) => r.textContent)).toEqual([
      'AAcme@acme4',
      'MMaria Souza@mariasouza2',
      'SSide projectNeeds reconnecting'
    ])
    expect(rows.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(document.activeElement).toBe(rows[0])
    // Arrow keys move between the rows.
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows[1])
  })

  it('switches to another account and closes', async () => {
    const fake = renderWithAccounts()
    fireEvent.click(await switcher())
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Maria Souza/ }))
    expect(fake.api.auth.setActive).toHaveBeenCalledWith('mariasouza')
    expect(screen.queryByRole('menu')).toBeNull()
    // Main says so, and the row follows; Acme's 4 now count as elsewhere.
    expect(await within(await switcher()).findByText('@mariasouza')).toBeTruthy()
    expect(await screen.findByLabelText('4 waiting in other accounts')).toBeTruthy()
  })

  it('closes on Escape and on a click outside', async () => {
    renderWithAccounts()
    fireEvent.click(await switcher())
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(await switcher())
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('offers Reconnect on a signed-out account, and shows why it failed', async () => {
    const fake = renderWithAccounts()
    vi.mocked(fake.api.auth.connect).mockRejectedValueOnce(new AuthError('timeout'))
    fireEvent.click(await switcher())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reconnect' }))
    expect(fake.api.auth.connect).toHaveBeenCalledTimes(1)
    expect((await screen.findByRole('alert')).textContent).toBe(
      "X didn't answer in time. Try again."
    )
    expect(screen.getAllByRole('menuitem', { name: 'Reconnect' })).toHaveLength(1)
  })

  it('adds an account through X sign-in, disabled while it connects', async () => {
    const fake = renderWithAccounts()
    let fail: (err: unknown) => void = () => {}
    vi.mocked(fake.api.auth.connect).mockReturnValueOnce(new Promise((_, no) => (fail = no)))
    fireEvent.click(await switcher())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add account' }))
    expect(fake.api.auth.connect).toHaveBeenCalledTimes(1)
    const adding = screen.getByRole('menuitem', { name: 'Connecting…' }) as HTMLButtonElement
    expect(adding.disabled).toBe(true)
    await act(async () => fail(new AuthError('cancelled')))
    expect(screen.getByRole('alert').textContent).toBe(
      "Sign-in was cancelled. Try again when you're ready."
    )
    expect(screen.getByRole('menuitem', { name: 'Add account' })).toBeTruthy()
  })

  it('closes once an account is added', async () => {
    const fake = renderWithAccounts()
    vi.mocked(fake.api.auth.connect).mockResolvedValueOnce({ accountId: 'new', handle: 'new' })
    fireEvent.click(await switcher())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add account' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('keeps the setup link while no account is connected', async () => {
    const fake = fakeApi()
    window.opencat = fake.api
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar connected />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    )
    await waitFor(() => expect(fake.api.auth.status).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Account switcher/ })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: /X account/ }))
    expect(screen.getByTestId('where').textContent).toBe('/setup')
  })

  describe('on the icon rail', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('shows the avatar with the elsewhere count on its corner, and the same menu', async () => {
      stubWindowWidth(1000)
      renderWithAccounts()
      const button = await switcher()
      expect(within(button).queryByText('@acme')).toBeNull()
      expect(button.getAttribute('title')).toBe('@acme')
      const badge = await within(button).findByTestId('rail-account-badge')
      expect(badge.textContent).toBe('2')
      expect(badge.getAttribute('aria-label')).toBe('2 waiting in other accounts')
      fireEvent.click(button)
      expect(screen.getAllByRole('menuitemradio')).toHaveLength(3)
    })
  })
})
