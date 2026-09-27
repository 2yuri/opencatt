import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ClaudeCliStatus } from '@shared/api'
import { chatMessage, fakeApi } from '../test/fakeApi'
import { AgentSettingsForm } from './AgentSettingsForm'
import { ChatPanel } from './ChatPanel'

afterEach(() => {
  cleanup()
})

describe('agent settings in the chat panel', () => {
  it('asks for a key when there is none, and saves one that passes the check', async () => {
    const fake = fakeApi([])
    fake.agentStatus.hasKey = false
    window.opencat = fake.api
    render(<ChatPanel />)

    expect(await screen.findByText('Set up the agent')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add API key' }))
    const input = await screen.findByLabelText('Anthropic API key')

    fireEvent.change(input, { target: { value: 'sk-bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Anthropic refused the API key.')

    fireEvent.change(input, { target: { value: 'sk-good' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByText(/Your key is saved/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }))
    expect(screen.queryByText('Set up the agent')).toBeNull()
    expect(screen.getByLabelText('Message the agent')).toBeTruthy()
  })

  it('changes the model and removes the key', async () => {
    const fake = fakeApi([])
    window.opencat = fake.api
    render(<ChatPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const select = (await screen.findByLabelText('Model')) as HTMLSelectElement
    expect(select.value).toBe('claude-opus-5')
    fireEvent.change(select, { target: { value: 'claude-sonnet-5' } })
    await waitFor(() => expect(fake.api.agent.setModel).toHaveBeenCalledWith('claude-sonnet-5'))

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByLabelText('Anthropic API key')).toBeTruthy()
  })

  it('takes a typed model id under Other… on the CLI path only (OP-93)', async () => {
    const fake = fakeApi([])
    fake.agentStatus.provider = 'cli'
    fake.agentStatus.cli = { ...fake.agentStatus.cli, found: true, loggedIn: true }
    window.opencat = fake.api
    render(<ChatPanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const select = (await screen.findByLabelText('Model')) as HTMLSelectElement
    fireEvent.change(select, { target: { value: '__other__' } })
    const input = await screen.findByLabelText('Model id')
    fireEvent.change(input, { target: { value: 'claude-opus-6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use' }))
    await waitFor(() => expect(fake.api.agent.setModel).toHaveBeenCalledWith('claude-opus-6'))
    await waitFor(() => expect(screen.queryByLabelText('Model id')).toBeNull())
  })

  it('offers no Other… on the API path, where the list comes from the key', async () => {
    const fake = fakeApi([])
    window.opencat = fake.api
    render(<ChatPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const select = (await screen.findByLabelText('Model')) as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).not.toContain('__other__')
  })

  it('explains a missing keyring instead of offering a key field', async () => {
    const fake = fakeApi([])
    Object.assign(fake.agentStatus, { hasKey: false, canStoreKey: false })
    window.opencat = fake.api
    render(<ChatPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect((await screen.findByRole('alert')).textContent).toContain('no keyring')
    expect(screen.queryByLabelText('Anthropic API key')).toBeNull()
  })

  it('opens settings from a refused-key error', async () => {
    const fake = fakeApi([])
    window.opencat = fake.api
    render(<ChatPanel />)
    await screen.findByText(/Tell the agent what to post/)
    act(() =>
      fake.emit({
        type: 'error',
        turnId: 't1',
        code: 'bad_key',
        message: 'Anthropic refused the API key.'
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    expect(await screen.findByLabelText('Model')).toBeTruthy()
  })

  it('says which provider answers, and labels each reply with it', async () => {
    const reply = { ...chatMessage('assistant', 'Done.'), via: 'Claude Code · Opus 5' }
    const fake = fakeApi([chatMessage('user', 'Schedule it'), reply])
    Object.assign(fake.agentStatus, { hasKey: false, provider: 'cli', cli: CLI_OK })
    window.opencat = fake.api
    render(<ChatPanel />)
    const pill = await screen.findByText('Claude Code', { selector: '.provider-pill' })
    expect(pill.getAttribute('data-state')).toBe('ready')
    expect(pill.getAttribute('title')).toBe('Replies come from Claude Code on your Max plan')
    expect(screen.getByText('Claude Code · Opus 5')).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

const CLI_OK: ClaudeCliStatus = {
  found: true,
  path: '/home/me/.local/bin/claude',
  version: '2.1.283',
  loggedIn: true,
  plan: 'max',
  error: null
}

describe('Claude Code in the agent settings', () => {
  it('shows the version, plan and path when it is ready', async () => {
    const fake = fakeApi([])
    Object.assign(fake.agentStatus, { hasKey: false, provider: 'cli', cli: CLI_OK })
    window.opencat = fake.api
    render(<ChatPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByText('Claude Code 2.1.283, logged in')).toBeTruthy()
    expect(screen.getByText('Max plan · /home/me/.local/bin/claude')).toBeTruthy()
    expect((screen.getByRole('radio', { name: /Claude Code/ }) as HTMLInputElement).checked).toBe(
      true
    )
    // No key form while the CLI answers and no key is saved.
    expect(screen.queryByLabelText('Anthropic API key')).toBeNull()
  })

  it('asks to log in, blocks the composer, and picks up the login on recheck', async () => {
    const fake = fakeApi([])
    Object.assign(fake.agentStatus, {
      hasKey: false,
      provider: 'cli',
      cli: { ...CLI_OK, loggedIn: false, plan: null }
    })
    window.opencat = fake.api
    render(<ChatPanel />)

    const card = await screen.findByRole('status')
    expect(card.textContent).toContain("Claude Code isn't logged in")
    expect(card.textContent).toContain('claude login')
    expect((screen.getByLabelText('Message the agent') as HTMLTextAreaElement).placeholder).toBe(
      'Set up the agent to start chatting'
    )
    expect(screen.getByText('Claude Code', { selector: '.provider-pill' }).dataset['state']).toBe(
      'login'
    )

    fake.agentStatus.cli.loggedIn = true
    fireEvent.click(screen.getByRole('button', { name: 'Recheck' }))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    expect(fake.api.agent.recheck).toHaveBeenCalledTimes(1)
  })

  it('rechecks when the window comes back into focus while logged out', async () => {
    const fake = fakeApi([])
    Object.assign(fake.agentStatus, {
      hasKey: false,
      provider: 'cli',
      cli: { ...CLI_OK, loggedIn: false }
    })
    window.opencat = fake.api
    render(<ChatPanel />)
    await screen.findByRole('status')
    fake.agentStatus.cli.loggedIn = true
    act(() => void window.dispatchEvent(new Event('focus')))
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('switches to an API key from the login card', async () => {
    const fake = fakeApi([])
    Object.assign(fake.agentStatus, {
      hasKey: false,
      provider: 'cli',
      cli: { ...CLI_OK, loggedIn: false }
    })
    window.opencat = fake.api
    render(<ChatPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Use an API key' }))
    expect(fake.api.agent.setProvider).toHaveBeenCalledWith('api')
    expect(await screen.findByLabelText('Anthropic API key')).toBeTruthy()
  })

  it('greys out Claude Code when it is not installed and links to the install page', async () => {
    const fake = fakeApi([])
    window.opencat = fake.api
    render(<ChatPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByText(/isn.t installed on this computer/)).toBeTruthy()
    expect((screen.getByRole('radio', { name: /Claude Code/ }) as HTMLInputElement).disabled).toBe(
      true
    )
    expect(screen.getByRole('link', { name: /Install Claude Code/ }).getAttribute('href')).toBe(
      'https://claude.com/claude-code'
    )
  })

  it('lets someone with the CLI choose their API key instead', async () => {
    const fake = fakeApi([])
    Object.assign(fake.agentStatus, { provider: 'cli', cli: CLI_OK })
    window.opencat = fake.api
    render(<ChatPanel />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('radio', { name: /Anthropic API key/ }))
    await waitFor(() => expect(fake.api.agent.setProvider).toHaveBeenCalledWith('api'))
    expect(await screen.findByText('API key', { selector: '.provider-pill' })).toBeTruthy()
  })
})

describe('agent settings, other agents', () => {
  it('links to Integrations instead of the MCP settings, and goes back to the chat', async () => {
    const fake = fakeApi([])
    window.opencat = fake.api
    const onOpenIntegrations = vi.fn()
    render(<ChatPanel onOpenIntegrations={onOpenIntegrations} />)
    const settings = await screen.findByRole('button', { name: 'Settings' })
    fireEvent.click(settings)

    const other = await screen.findByRole('region', { name: 'Other agents' })
    expect(other.textContent).toContain('Other agents (MCP)')
    expect(screen.queryByRole('checkbox', { name: /schedule posts/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
    expect(fake.api.mcp.status).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Open Integrations' }))
    expect(onOpenIntegrations).toHaveBeenCalledTimes(1)
    expect(settings.getAttribute('aria-pressed')).toBe('false')
  })
})

describe('AgentSettingsForm images', () => {
  it('turns sending attached images to the agent off and on', async () => {
    const fake = fakeApi([])
    window.opencat = fake.api
    const onChange = vi.fn()
    const status = await fake.api.agent.status()
    render(
      <AgentSettingsForm
        status={status}
        onChange={onChange}
        onDone={() => {}}
        onOpenIntegrations={() => {}}
      />
    )

    const box = screen.getByLabelText('Show images you attach in the chat to the agent')
    expect((box as HTMLInputElement).checked).toBe(true)
    fireEvent.click(box)
    await waitFor(() => expect(fake.api.agent.setSendImages).toHaveBeenCalledWith(false))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sendImages: false }))
  })
})
