import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { AgentStatus, OnboardingStatus } from '@shared/api'
import { FirstRunGate } from '../App'
import { EditorProvider } from '../editor/EditorProvider'
import { fakeApi, xAccount } from '../test/fakeApi'

afterEach(() => {
  cleanup()
})

const fresh: OnboardingStatus = {
  complete: false,
  authMode: null,
  clientId: null,
  secureStorage: true
}
const done: OnboardingStatus = {
  complete: true,
  authMode: 'oauth2',
  clientId: 'dGhpc2lzYW5leGFtcGxlOjE6Y2k',
  secureStorage: true
}

const claudeCode: AgentStatus['cli'] = {
  found: true,
  path: '/usr/local/bin/claude',
  version: '2.1.283',
  loggedIn: true,
  plan: 'max',
  error: null
}

function mockApi(
  status: OnboardingStatus,
  {
    connect,
    agent,
    handle
  }: {
    connect?: () => Promise<unknown>
    agent?: Partial<AgentStatus>
    /** The account auth.status answers with once connected (OP-75's voice step). */
    handle?: string
  } = {}
) {
  const fake = fakeApi()
  const onboarding = {
    status: vi.fn().mockResolvedValue(status),
    saveClientId: vi
      .fn()
      .mockResolvedValue({ ...fresh, authMode: 'oauth2', clientId: done.clientId }),
    saveOAuth1Keys: vi.fn(),
    complete: vi.fn().mockResolvedValue(done)
  }
  const app = {
    getOpenAtLogin: vi.fn().mockResolvedValue(false),
    setOpenAtLogin: vi.fn().mockResolvedValue(undefined)
  }
  const auth = connect
    ? {
        connect: vi.fn(connect),
        ...(handle && {
          status: vi.fn().mockResolvedValue({
            accounts: [xAccount(handle)],
            activeAccountId: handle,
            secureStorage: true
          })
        })
      }
    : undefined
  // Without `connect`, the build has no X sign-in yet: no auth at all.
  Object.assign(fake.api, { onboarding, app, auth })
  Object.assign(fake.agentStatus, agent)
  Object.assign(fake.api.posts, {
    listRange: vi.fn().mockResolvedValue({}),
    listByDay: vi.fn().mockResolvedValue([])
  })
  window.opencat = fake.api
  render(
    <MemoryRouter initialEntries={['/']}>
      <EditorProvider>
        <FirstRunGate />
      </EditorProvider>
    </MemoryRouter>
  )
  return { onboarding, app, auth, agent: fake.api.agent, voice: fake.api.voice }
}

const button = (name: string | RegExp): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement

/** Welcome → X app → Client ID, saved; leaves the wizard on step 4. */
async function toConnect(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Get started' }))
  fireEvent.click(button('Next'))
  fireEvent.change(screen.getByLabelText('OAuth 2.0 Client ID'), {
    target: { value: done.clientId }
  })
  fireEvent.click(button('Next'))
  await screen.findByText('Connect your X account')
}

async function toAgent(): Promise<void> {
  await toConnect()
  fireEvent.click(button('Next'))
  await screen.findByText('Set up the agent', { selector: 'h1' })
}

describe('FirstRunGate', () => {
  it('shows the calendar once onboarding is complete', async () => {
    mockApi(done)
    expect(await screen.findByRole('group', { name: 'View' })).toBeTruthy()
    expect(screen.queryByText('First-time setup')).toBeNull()
  })

  it('opens the wizard on a fresh install, with the seven steps and the cost note', async () => {
    mockApi(fresh)
    expect(
      await screen.findByRole('heading', {
        name: 'Schedule your X posts, with an agent that asks first'
      })
    ).toBeTruthy()
    expect(screen.getByText('Step 1 of 7')).toBeTruthy()
    const rail = within(screen.getByRole('list', { name: 'Setup steps' }))
    expect(rail.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1Welcome',
      '2Create your X app',
      '3Paste your Client ID',
      '4Connect your account',
      '5How your posts sound',
      '6Set up the agent',
      '7Keep posts on time'
    ])
    expect(rail.getByText('Welcome').closest('li')?.getAttribute('aria-current')).toBe('step')
    expect(screen.getByTestId('cost-note').textContent).toMatch(/Pay Per Use or higher/)
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull()
  })

  it('ticks the X app checklist and counts what is done', async () => {
    mockApi(fresh)
    fireEvent.click(await screen.findByRole('button', { name: 'Get started' }))
    expect(screen.getByText('Step 2 of 7')).toBeTruthy()
    expect(screen.getByText('http://127.0.0.1:47823/callback')).toBeTruthy()
    expect(screen.getByText('0 of 9 done')).toBeTruthy()
    // The first open step shows its detail.
    expect(screen.getByText(/Use the X account you want OpenCatt to post as/)).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Sign in to the X Developer Console'))
    fireEvent.click(screen.getByLabelText("Check your project's plan"))
    fireEvent.click(screen.getByLabelText('Create an app'))
    expect(screen.getByText('3 of 9 done')).toBeTruthy()
    expect(screen.queryByText(/Use the X account you want OpenCatt to post as/)).toBeNull()
    expect(screen.getByText(/Never share them, and paste them only into OpenCatt/)).toBeTruthy()

    // Ticks survive going back and forth.
    fireEvent.click(button('Next'))
    fireEvent.click(button('Back'))
    expect(screen.getByText('3 of 9 done')).toBeTruthy()
  })

  it('walks through the wizard, validating the client ID before Next', async () => {
    const api = mockApi(fresh)
    fireEvent.click(await screen.findByRole('button', { name: 'Get started' }))
    fireEvent.click(button('Next'))

    const input = screen.getByLabelText('OAuth 2.0 Client ID')
    expect(button('Next').disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'short' } })
    expect(screen.getByRole('alert').textContent).toMatch(/too short/)
    expect(button('Next').disabled).toBe(true)

    fireEvent.change(input, { target: { value: '  dGhpc2lzYW5leGFtcGxlOjE6Y2k ' } })
    expect(screen.getByText('Looks like a Client ID')).toBeTruthy()
    expect(button('Next').disabled).toBe(false)
    fireEvent.click(button('Next'))

    // Without OP-5's sign-in there is nothing to connect, and Next goes on.
    expect(await screen.findByText(/comes with the X sign-in update/)).toBeTruthy()
    expect(button('Next').disabled).toBe(false)
    fireEvent.click(button('Next'))

    await screen.findByText('Set up the agent', { selector: 'h1' })
    fireEvent.click(button('Skip for now'))

    expect(await screen.findByText('Keep your posts on time')).toBeTruthy()
    expect(screen.getByText('X app created and Client ID saved')).toBeTruthy()
    expect(screen.getByText('Set up the agent later from the chat panel')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Start OpenCatt when I log in' })).toBeTruthy()
    fireEvent.click(button('Open my calendar'))
    expect(await screen.findByRole('group', { name: 'View' })).toBeTruthy()
    expect(api.onboarding.saveClientId).toHaveBeenCalledWith('dGhpc2lzYW5leGFtcGxlOjE6Y2k')
    expect(api.app.setOpenAtLogin).toHaveBeenCalledWith(true)
    expect(api.onboarding.complete).toHaveBeenCalled()
    expect(api.agent.setProvider).not.toHaveBeenCalled()
  })

  it('offers pasted keys, and disables them without a keyring', async () => {
    mockApi({ ...fresh, secureStorage: false })
    fireEvent.click(await screen.findByRole('button', { name: 'Get started' }))
    fireEvent.click(button('Next'))
    fireEvent.click(button(/Paste keys instead/))
    expect(screen.getByRole('heading', { name: 'Paste your keys' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toMatch(/GNOME Keyring or KWallet/)
    expect((screen.getByLabelText('Consumer Key (API Key)') as HTMLInputElement).disabled).toBe(
      true
    )
    expect(button('Next').disabled).toBe(true)
    fireEvent.click(button('Use the Client ID instead'))
    expect(screen.getByLabelText('OAuth 2.0 Client ID')).toBeTruthy()
  })

  it('connects the X account through the sign-in when there is one', async () => {
    const api = mockApi(fresh, { connect: () => Promise.resolve({ handle: '@yourname' }) })
    await toConnect()
    expect(button('Next').disabled).toBe(true)
    fireEvent.click(button('Connect X account'))
    expect(await screen.findByText('Connected as @yourname')).toBeTruthy()
    expect(api.auth?.connect).toHaveBeenCalledTimes(1)
    expect(button('Next').disabled).toBe(false)

    fireEvent.click(button('Next'))
    await screen.findByText('Set up the agent', { selector: 'h1' })
    fireEvent.click(button('Skip for now'))
    expect(await screen.findByText('Posting as @yourname')).toBeTruthy()
  })

  it('shows why connecting failed, with the callback hint, and lets the user try again', async () => {
    let attempt = 0
    mockApi(fresh, {
      connect: () =>
        ++attempt === 1
          ? Promise.reject(
              new Error("Error invoking remote method 'auth:connect': AuthError: X said no.")
            )
          : Promise.resolve('someone')
    })
    await toConnect()
    fireEvent.click(button('Connect X account'))
    expect((await screen.findByRole('alert')).textContent).toBe('X said no.')
    expect(screen.getByText(/callback doesn't match/)).toBeTruthy()
    expect(button('Next').disabled).toBe(true)

    fireEvent.click(button('Try again'))
    expect(await screen.findByText('Connected as @someone')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows Claude Code when it is found, and saves the choice on Next', async () => {
    const api = mockApi(fresh, { agent: { provider: 'cli', cli: claudeCode, hasKey: false } })
    await toAgent()
    expect(await screen.findByText('Claude Code 2.1.283, logged in · Max plan')).toBeTruthy()
    expect(screen.getByText('Found on this computer')).toBeTruthy()
    const cli = screen.getByRole('radio', { name: /Claude Code/ }) as HTMLInputElement
    expect(cli.checked).toBe(true)

    fireEvent.click(button('Next'))
    expect(await screen.findByText('Agent runs on Claude Code (Max plan)')).toBeTruthy()
    expect(api.agent.setProvider).toHaveBeenCalledWith('cli')
  })

  it('switches the agent to an API key', async () => {
    const api = mockApi(fresh, { agent: { provider: 'cli', cli: claudeCode, hasKey: true } })
    await toAgent()
    await screen.findByText('Found on this computer')
    fireEvent.click(screen.getByRole('radio', { name: /Anthropic API key/ }))
    expect(api.agent.setProvider).toHaveBeenCalledWith('api')
    await vi.waitFor(() =>
      expect(
        (screen.getByRole('radio', { name: /Anthropic API key/ }) as HTMLInputElement).checked
      ).toBe(true)
    )

    fireEvent.click(button('Next'))
    expect(await screen.findByText('Agent runs on your Anthropic API key')).toBeTruthy()
    expect(api.agent.setProvider).toHaveBeenCalledTimes(1)
  })

  it('says how to get Claude Code when it is missing, and rechecks', async () => {
    const api = mockApi(fresh)
    await toAgent()
    expect(await screen.findByText(/isn.t installed on this computer/)).toBeTruthy()
    expect((screen.getByRole('radio', { name: /Claude Code/ }) as HTMLInputElement).disabled).toBe(
      true
    )
    fireEvent.click(button('Recheck'))
    expect(api.agent.recheck).toHaveBeenCalled()
  })

  it('leaves start at login off when the user turns it off', async () => {
    const api = mockApi(fresh)
    await toAgent()
    fireEvent.click(button('Skip for now'))
    const toggle = await screen.findByRole('switch', { name: 'Start OpenCatt when I log in' })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(button('Open my calendar'))
    expect(await screen.findByRole('group', { name: 'View' })).toBeTruthy()
    expect(api.app.setOpenAtLogin).toHaveBeenCalledWith(false)
  })

  it('asks how posts should sound after connecting, and saves the answers', async () => {
    const api = mockApi(fresh, {
      connect: () => Promise.resolve({ handle: 'acme' }),
      handle: 'acme'
    })
    await toConnect()
    fireEvent.click(button('Connect X account'))
    await screen.findByText('Connected as @acme')
    fireEvent.click(button('Next'))

    expect(
      await screen.findByRole('heading', { name: 'How should your posts sound?' })
    ).toBeTruthy()
    expect(screen.getByText('Step 5 of 7')).toBeTruthy()
    expect(screen.getByText(/Tell the agent how @acme posts, in your own words/)).toBeTruthy()
    const text = screen.getByLabelText<HTMLTextAreaElement>('In a sentence or two')
    fireEvent.change(text, { target: { value: 'Short and plain.' } })
    fireEvent.click(button('Add Direct'))
    expect(text.value).toBe('Short and plain. Direct and to the point.')
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'es' } })
    fireEvent.click(button('Never'))
    fireEvent.click(button('Save and continue'))

    await screen.findByText('Set up the agent', { selector: 'h1' })
    expect(api.voice.set).toHaveBeenCalledWith('acme', {
      description: 'Short and plain. Direct and to the point.',
      language: 'es',
      images: 'never'
    })
    // Back from the agent comes back here.
    fireEvent.click(button('Back'))
    expect(
      await screen.findByRole('heading', { name: 'How should your posts sound?' })
    ).toBeTruthy()
  })

  it('lets the voice wait for later', async () => {
    const api = mockApi(fresh, {
      connect: () => Promise.resolve({ handle: 'acme' }),
      handle: 'acme'
    })
    await toConnect()
    fireEvent.click(button('Connect X account'))
    await screen.findByText('Connected as @acme')
    fireEvent.click(button('Next'))
    await screen.findByRole('heading', { name: 'How should your posts sound?' })
    fireEvent.click(button('Skip for now'))
    await screen.findByText('Set up the agent', { selector: 'h1' })
    expect(api.voice.set).not.toHaveBeenCalled()
  })

  it('skips the voice step without an account, both ways', async () => {
    mockApi(fresh)
    await toAgent()
    expect(screen.queryByRole('heading', { name: 'How should your posts sound?' })).toBeNull()
    fireEvent.click(button('Back'))
    expect(await screen.findByText('Connect your X account')).toBeTruthy()
  })

  it('reopens the wizard from the Settings screen', async () => {
    mockApi(done)
    fireEvent.click(await screen.findByRole('link', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('link', { name: 'Open setup' }))
    expect(await screen.findByText('First-time setup')).toBeTruthy()
    // Full window, without the app's sidebar, and with a way back.
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the app' }))
    expect(await screen.findByRole('link', { name: 'Settings' })).toBeTruthy()
  })
})
