import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { AuthError } from '@shared/authErrors'
import { fakeApi, xAccount, type FakeApi } from '../test/fakeApi'
import { IntegrationsScreen } from './IntegrationsScreen'

afterEach(() => cleanup())

function renderScreen(setup?: (fake: FakeApi) => void): FakeApi {
  const fake = fakeApi([])
  setup?.(fake)
  window.opencat = fake.api
  render(
    <MemoryRouter>
      <IntegrationsScreen />
    </MemoryRouter>
  )
  return fake
}

const mcpSwitch = (): HTMLButtonElement =>
  screen.getByRole<HTMLButtonElement>('switch', { name: 'Let outside agents schedule posts' })

/** Renders with the server turned on through the switch, as a user would. */
async function renderEnabled(): Promise<FakeApi> {
  const fake = renderScreen()
  await waitFor(() => expect(mcpSwitch().disabled).toBe(false))
  fireEvent.click(mcpSwitch())
  await screen.findByRole('tablist', { name: 'Set up' })
  return fake
}

describe('IntegrationsScreen, MCP server', () => {
  it('turns the server on and off with the switch, saying whether it runs', async () => {
    const fake = renderScreen()
    await waitFor(() => expect(mcpSwitch().disabled).toBe(false))
    expect(mcpSwitch().getAttribute('aria-checked')).toBe('false')
    expect(screen.getByTestId('mcp-state').textContent).toBe('Off')
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByText('What agents can do')).toBeNull()
    expect(screen.queryByText('Access token')).toBeNull()

    fireEvent.click(mcpSwitch())
    await waitFor(() => expect(fake.api.mcp.setEnabled).toHaveBeenCalledWith(true))
    await waitFor(() =>
      expect(screen.getByTestId('mcp-state').textContent).toBe('Running on 127.0.0.1:47824')
    )
    expect(mcpSwitch().getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('tablist', { name: 'Set up' })).toBeTruthy()
    const tools = within(screen.getByRole('list', { name: 'Tools' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(tools).toEqual([
      'create_posts',
      'list_posts',
      'reschedule_post',
      'current_time',
      'list_accounts'
    ])
    expect(screen.getByText(/waits in Approvals, unless the account has Autopilot on/)).toBeTruthy()
    expect(screen.getByText('Access token')).toBeTruthy()

    fireEvent.click(mcpSwitch())
    await waitFor(() => expect(fake.api.mcp.setEnabled).toHaveBeenLastCalledWith(false))
    await waitFor(() => expect(screen.getByTestId('mcp-state').textContent).toBe('Off'))
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByText('Access token')).toBeNull()
  })

  it('shows why the server is not running although it is on', async () => {
    renderScreen((fake) =>
      vi.mocked(fake.api.mcp.status).mockResolvedValueOnce({
        enabled: true,
        running: false,
        error: 'Port 47824 is already in use by another app.'
      })
    )
    await waitFor(() =>
      expect(screen.getByTestId('mcp-state').textContent).toBe(
        'Port 47824 is already in use by another app.'
      )
    )
    expect(screen.getByTestId('mcp-state').querySelector('.bg-ds-red')).toBeTruthy()
    expect(mcpSwitch().getAttribute('aria-checked')).toBe('true')
  })

  it('shows the steps and snippet for each app, and copies it', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    Object.assign(navigator, { clipboard: { writeText } })
    await renderEnabled()

    const desktop = screen.getByRole('tab', { name: 'Claude Desktop' })
    expect(desktop.getAttribute('aria-selected')).toBe('true')
    expect(
      screen.getByText("Open Claude Desktop's settings, then Developer → Edit Config.")
    ).toBeTruthy()
    expect(screen.getByLabelText('Config').textContent).toContain('mcpServers')

    fireEvent.click(screen.getByRole('tab', { name: 'Claude Code' }))
    expect(screen.getByRole('tab', { name: 'Claude Code' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    expect(screen.getByText('Run this in a terminal.')).toBeTruthy()
    expect(screen.getByText(/OpenCatt's tools show up in \/mcp\./)).toBeTruthy()
    expect(screen.queryByLabelText('Config')).toBeNull()
    const command = screen.getByLabelText('Command')
    expect(command.textContent).toContain('claude mcp add')

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(command.textContent))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
    // Back to Copy after two seconds.
    expect(await screen.findByRole('button', { name: 'Copy' }, { timeout: 3000 })).toBeTruthy()
  })

  it('regenerates the token only once confirmed, and shows the new snippet', async () => {
    const fake = await renderEnabled()
    fireEvent.click(screen.getByRole('tab', { name: 'Claude Code' }))
    expect(screen.getByLabelText('Command').textContent).toContain('Bearer tok-1')

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate token' }))
    const confirm = screen.getByRole('group', { name: 'Regenerate the access token?' })
    expect(confirm.textContent).toContain('stop working')
    expect(screen.queryByText('Access token')).toBeNull()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Access token')).toBeTruthy()
    expect(fake.api.mcp.regenerateToken).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate token' }))
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(fake.api.mcp.regenerateToken).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByLabelText('Command').textContent).toContain('Bearer tok-2')
    )
    expect(screen.queryByRole('group', { name: 'Regenerate the access token?' })).toBeNull()
    expect(screen.getByText('Access token')).toBeTruthy()
  })
})

function withAccounts(fake: FakeApi): void {
  Object.assign(fake.authStatus, {
    accounts: [
      xAccount('acme', { name: 'Acme' }),
      xAccount('mariasouza', { name: 'Maria Souza' }),
      xAccount('sideproj', { name: 'Side project', needsReconnect: true })
    ],
    activeAccountId: 'acme'
  })
}

const row = (name: string): HTMLElement => screen.getByRole('group', { name })

describe('IntegrationsScreen, X accounts', () => {
  it('lists each account with whether it is connected', async () => {
    renderScreen(withAccounts)
    await screen.findByRole('group', { name: 'Acme' })
    expect(row('Acme').textContent).toContain('@acme')
    expect(within(row('Acme')).getByText('Connected')).toBeTruthy()
    expect(within(row('Maria Souza')).getByText('Connected')).toBeTruthy()
    expect(within(row('Side project')).getByText('Needs reconnecting')).toBeTruthy()
    // Reconnect only where it is needed; Disconnect everywhere.
    expect(within(row('Acme')).queryByRole('button', { name: 'Reconnect' })).toBeNull()
    expect(within(row('Side project')).getByRole('button', { name: 'Reconnect' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Disconnect' })).toHaveLength(3)
    expect(screen.queryByText('No X account connected yet.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add an X account' })).toBeTruthy()
  })

  it('reconnects through X sign-in and says why it failed', async () => {
    const fake = renderScreen(withAccounts)
    const reconnect = await within(
      await screen.findByRole('group', { name: 'Side project' })
    ).findByRole('button', { name: 'Reconnect' })
    vi.mocked(fake.api.auth.connect).mockRejectedValueOnce(new AuthError('cancelled'))
    fireEvent.click(reconnect)
    expect((await within(row('Side project')).findByRole('alert')).textContent).toBe(
      "Sign-in was cancelled. Try again when you're ready."
    )

    let done!: (value: { accountId: string; handle: string }) => void
    vi.mocked(fake.api.auth.connect).mockReturnValueOnce(new Promise((resolve) => (done = resolve)))
    fireEvent.click(within(row('Side project')).getByRole('button', { name: 'Reconnect' }))
    expect(
      await within(row('Side project')).findByRole('button', { name: 'Connecting…' })
    ).toBeTruthy()
    expect(within(row('Side project')).queryByRole('alert')).toBeNull()
    act(() => {
      fake.authChanged({
        accounts: fake.authStatus.accounts.map((a) => ({ ...a, needsReconnect: false }))
      })
      done({ accountId: 'sideproj', handle: 'sideproj' })
    })
    await waitFor(() => expect(within(row('Side project')).getByText('Connected')).toBeTruthy())
    expect(
      within(row('Side project')).queryByRole('button', { name: /Reconnect|Connecting/ })
    ).toBeNull()
  })

  it('disconnects only once confirmed', async () => {
    const fake = renderScreen(withAccounts)
    await screen.findByRole('group', { name: 'Acme' })
    fireEvent.click(within(row('Acme')).getByRole('button', { name: 'Disconnect' }))
    const confirm = screen.getByRole('group', { name: 'Disconnect @acme?' })
    expect(confirm.textContent).toContain("won't go out until you connect it again")
    expect(screen.queryByRole('group', { name: 'Acme' })).toBeNull()

    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(row('Acme')).toBeTruthy()
    expect(fake.api.auth.disconnect).not.toHaveBeenCalled()

    fireEvent.click(within(row('Acme')).getByRole('button', { name: 'Disconnect' }))
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Disconnect @acme?' })).getByRole('button', {
        name: 'Disconnect'
      })
    )
    await waitFor(() => expect(fake.api.auth.disconnect).toHaveBeenCalledWith('acme'))
    expect(await screen.findByRole('group', { name: 'Acme' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Disconnect @acme?' })).toBeNull()
  })

  it('adds an account, saying so while it connects and why it failed', async () => {
    const fake = renderScreen()
    expect(await screen.findByText('No X account connected yet.')).toBeTruthy()

    let fail!: (err: unknown) => void
    vi.mocked(fake.api.auth.connect).mockReturnValueOnce(
      new Promise((_, reject) => (fail = reject))
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add an X account' }))
    const busy = await screen.findByRole('button', { name: 'Connecting…' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    act(() => fail(new AuthError('timeout')))
    expect((await screen.findByRole('alert')).textContent).toBe(
      "X didn't answer in time. Try again."
    )
    expect(screen.getByRole('alert').className).toContain('text-ds-red')

    vi.mocked(fake.api.auth.connect).mockImplementationOnce(() => {
      fake.authChanged({ accounts: [xAccount('acme', { name: 'Acme' })], activeAccountId: 'acme' })
      return Promise.resolve({ accountId: 'acme', handle: 'acme' })
    })
    fireEvent.click(screen.getByRole('button', { name: /Add an X account/ }))
    expect(await screen.findByRole('group', { name: 'Acme' })).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.queryByText('No X account connected yet.')).toBeNull()
  })
})
