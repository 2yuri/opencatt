import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { Shell } from '../App'
import { PostCard } from '../chat/PostCard'
import { EditorProvider } from '../editor/EditorProvider'
import { IntegrationsScreen } from '../integrations/IntegrationsScreen'
import { SettingsScreen } from '../settings/SettingsScreen'
import { fakeApi, post, xAccount, type FakeApi } from '../test/fakeApi'

afterEach(() => cleanup())

const BODY =
  'Posts Claude or a connected agent writes for @acme will be scheduled without asking you. You can still edit or delete them before they go out.'

/** The app with @acme active: the sidebar, the calendar and the agent panel. */
function renderShell(setup?: (fake: FakeApi) => void): FakeApi {
  const fake = fakeApi()
  fake.authStatus.accounts = [xAccount('acme', { name: 'Acme' })]
  fake.authStatus.activeAccountId = 'acme'
  Object.assign(fake.api.posts, {
    listRange: vi.fn().mockResolvedValue({}),
    pending: vi.fn().mockResolvedValue({ count: 0, first: null }),
    listByDay: vi.fn().mockResolvedValue([])
  })
  setup?.(fake)
  window.opencat = fake.api
  render(
    <MemoryRouter initialEntries={['/?view=month&date=2026-09-26']}>
      <EditorProvider>
        <Shell setupStatus={{ complete: true } as never} />
      </EditorProvider>
    </MemoryRouter>
  )
  return fake
}

/** The agent panel's switch, once main has said whether Autopilot is on. */
const barSwitch = (): Promise<HTMLButtonElement> =>
  waitFor(() => {
    const found = screen.getByRole<HTMLButtonElement>('switch', { name: 'Autopilot' })
    expect(found.disabled).toBe(false)
    return found
  })

const panelBadge = (): HTMLElement | null =>
  document.querySelector('.provider-pill [data-testid="autopilot-badge"]')

const switcherBadge = (): HTMLElement | null =>
  within(screen.getByRole('button', { name: /Account switcher/ })).queryByTestId('autopilot-badge')

describe('Autopilot in the agent panel (OP-104)', () => {
  it('shows the account and an off switch under the header', async () => {
    renderShell()
    const sw = await barSwitch()
    expect(sw.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('acme')).toBeTruthy()
    await waitFor(() =>
      expect(document.querySelector('.provider-pill')?.textContent).toBe('API key')
    )
    expect(panelBadge()).toBeNull()
  })

  it('asks before turning it on; Cancel leaves it off', async () => {
    const fake = renderShell()
    fireEvent.click(await barSwitch())
    const dialog = screen.getByRole('dialog', { name: 'Turn on Autopilot for @acme?' })
    expect(within(dialog).getByText(BODY)).toBeTruthy()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((await barSwitch()).getAttribute('aria-checked')).toBe('false')
    expect(fake.api.autopilot.set).not.toHaveBeenCalled()
  })

  it('Escape closes the question too', async () => {
    const fake = renderShell()
    fireEvent.click(await barSwitch())
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fake.api.autopilot.set).not.toHaveBeenCalled()
  })

  it('Turn on sets it, and the badge shows in the panel and the account switcher', async () => {
    const fake = renderShell()
    fireEvent.click(await barSwitch())
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(fake.api.autopilot.set).toHaveBeenCalledWith('acme', true)
    await waitFor(() => expect(panelBadge()?.textContent).toBe('Autopilot'))
    await waitFor(() => expect(switcherBadge()?.textContent).toBe('Autopilot'))
    expect((await barSwitch()).getAttribute('aria-checked')).toBe('true')
  })

  it('turns off without asking', async () => {
    const fake = renderShell((f) => f.autopilot.add('acme'))
    const sw = await barSwitch()
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(sw)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fake.api.autopilot.set).toHaveBeenCalledWith('acme', false)
    await waitFor(() => expect(panelBadge()).toBeNull())
    expect(switcherBadge()).toBeNull()
  })

  it('says why when main refuses, and puts the switch back', async () => {
    const fake = renderShell()
    vi.mocked(fake.api.autopilot.set).mockRejectedValueOnce(
      new Error(
        "Error invoking remote method 'autopilot:set': Error: Reconnect @acme to change Autopilot."
      )
    )
    fireEvent.click(await barSwitch())
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Reconnect @acme to change Autopilot.'
    )
    expect((await barSwitch()).getAttribute('aria-checked')).toBe('false')
    expect(panelBadge()).toBeNull()
  })

  it('keeps the switch where it is while a slow change is on its way', async () => {
    const fake = renderShell()
    let finish: (on: boolean) => void = () => {}
    vi.mocked(fake.api.autopilot.set).mockImplementationOnce(
      () => new Promise<boolean>((resolve) => (finish = resolve))
    )
    fireEvent.click(await barSwitch())
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    const sw = screen.getByRole<HTMLButtonElement>('switch', { name: 'Autopilot' })
    expect(sw.getAttribute('aria-checked')).toBe('true')
    expect(sw.disabled).toBe(true)
    await act(async () => finish(true))
    expect((await barSwitch()).getAttribute('aria-checked')).toBe('true')
  })

  it('follows a change made elsewhere', async () => {
    const fake = renderShell()
    await barSwitch()
    act(() => fake.autopilotChanged('acme', true))
    expect((await barSwitch()).getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(panelBadge()).toBeTruthy())
    // Another account's change is not this one's.
    act(() => fake.autopilotChanged('other', false))
    expect((await barSwitch()).getAttribute('aria-checked')).toBe('true')
    act(() => fake.autopilotChanged('acme', false))
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Autopilot' }).getAttribute('aria-checked')).toBe(
        'false'
      )
    )
  })

  it('has no bar without an account', async () => {
    renderShell((f) => {
      f.authStatus.accounts = []
      f.authStatus.activeAccountId = null
    })
    await screen.findByRole('button', { name: 'Voice settings' })
    await waitFor(() => expect(document.querySelector('.provider-pill')).toBeTruthy())
    expect(screen.queryByRole('switch', { name: 'Autopilot' })).toBeNull()
  })
})

describe('A post Autopilot scheduled, in the chat (OP-104)', () => {
  function show(fields: Partial<Parameters<typeof post>[0]> = {}): FakeApi {
    const fake = fakeApi([])
    fake.posts.set(
      'p1',
      post({
        id: 'p1',
        text: 'We launch today.',
        // Tuesday 29 September, 14:30 in Lisbon.
        scheduledAt: '2026-09-29T13:30:00Z',
        createdBy: 'agent',
        autopilot: true,
        ...fields
      })
    )
    window.opencat = fake.api
    Object.assign(fake.api.posts, {
      delete: vi.fn((id: string) => {
        fake.posts.delete(id)
        fake.changed({ ids: [id] })
        return Promise.resolve()
      })
    })
    render(
      <MemoryRouter>
        <EditorProvider>
          <PostCard postId="p1" action="created" now={() => new Date('2026-09-27T10:00:00Z')} />
        </EditorProvider>
      </MemoryRouter>
    )
    return fake
  }

  it('says Autopilot scheduled it, with Edit and Delete instead of Approve', async () => {
    show()
    const card = await screen.findByRole('article')
    expect(within(card).getByText('Scheduled by Autopilot · Tue 29 Sep · 14:30')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Delete' })).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('Edit opens the post in the editor', async () => {
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('Delete asks, then deletes the post', async () => {
    const fake = show()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(screen.getByText('Delete this post?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(fake.api.posts.delete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(fake.api.posts.delete).toHaveBeenCalledWith('p1')
    expect(await screen.findByText('This post was deleted.')).toBeTruthy()
  })

  it('shows a posted one as posted, like any other', async () => {
    show({ status: 'posted' })
    const card = await screen.findByRole('article')
    expect(card.textContent).toContain('Posted')
    expect(within(card).queryByText(/Scheduled by Autopilot/)).toBeNull()
  })
})

function Where(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.hash}</output>
}

describe('Autopilot in Settings and Integrations (OP-104)', () => {
  function renderAt(path: string, setup?: (fake: FakeApi) => void): FakeApi {
    const fake = fakeApi()
    fake.authStatus.accounts = [xAccount('acme')]
    fake.authStatus.activeAccountId = 'acme'
    setup?.(fake)
    window.opencat = fake.api
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/integrations" element={<IntegrationsScreen />} />
        </Routes>
        <Where />
      </MemoryRouter>
    )
    return fake
  }

  it('has a Posting section for the active account, between Accounts and Agent', async () => {
    const fake = renderAt('/settings')
    const section = await screen.findByRole('region', { name: 'Posting' })
    expect(section.id).toBe('autopilot')
    expect(within(section).getByText('for @acme')).toBeTruthy()
    expect(
      within(section).getByText(
        'Posts Claude or a connected agent writes for @acme are scheduled without asking you.'
      )
    ).toBeTruthy()
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings.slice(headings.indexOf('Accounts'))).toEqual(['Accounts', 'Posting', 'Agent'])

    const sw = await waitFor(() => {
      const found = within(section).getByRole<HTMLButtonElement>('switch', { name: 'Autopilot' })
      expect(found.disabled).toBe(false)
      return found
    })
    fireEvent.click(sw)
    const dialog = screen.getByRole('dialog', { name: 'Turn on Autopilot for @acme?' })
    expect(within(dialog).getByText(BODY)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }))
    expect(fake.api.autopilot.set).toHaveBeenCalledWith('acme', true)
    await waitFor(() => expect(sw.getAttribute('aria-checked')).toBe('true'))
  })

  it('shows a refusal under the row', async () => {
    const fake = renderAt('/settings', (f) => f.autopilot.add('acme'))
    vi.mocked(fake.api.autopilot.set).mockRejectedValueOnce(new Error('Could not save that.'))
    const section = await screen.findByRole('region', { name: 'Posting' })
    const sw = await waitFor(() => {
      const found = within(section).getByRole<HTMLButtonElement>('switch', { name: 'Autopilot' })
      expect(found.getAttribute('aria-checked')).toBe('true')
      return found
    })
    fireEvent.click(sw)
    expect((await within(section).findByRole('alert')).textContent).toBe('Could not save that.')
    expect(sw.getAttribute('aria-checked')).toBe('true')
  })

  it('has no Posting section without an account', async () => {
    renderAt('/settings', (f) => {
      f.authStatus.accounts = []
      f.authStatus.activeAccountId = null
    })
    // Voice says so once auth has answered, so a missing section is missing for good.
    await screen.findByText(/to set its voice/)
    expect(screen.queryByRole('region', { name: 'Posting' })).toBeNull()
  })

  it('notes Autopilot in the MCP box, with a link to its setting', async () => {
    renderAt('/integrations', (f) => {
      void f.api.mcp.setEnabled(true)
    })
    expect(
      await screen.findByText(
        'On accounts with Autopilot on, posts from outside agents are scheduled straight away.'
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Everything they create waits in Approvals, unless the account has Autopilot on.'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Autopilot settings' }))
    expect(screen.getByTestId('where').textContent).toBe('/settings#autopilot')
    expect(await screen.findByRole('region', { name: 'Posting' })).toBeTruthy()
  })
})
