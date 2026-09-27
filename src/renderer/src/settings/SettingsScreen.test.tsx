import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { onOpenAgentSettings } from '../chat/agentSettingsRequest'
import { fakeApi } from '../test/fakeApi'
import { SettingsScreen } from './SettingsScreen'

let getOpenAtLogin: ReturnType<typeof vi.fn>
let setOpenAtLogin: ReturnType<typeof vi.fn>
let settings: Map<string, unknown>

function Where(): React.JSX.Element {
  return <output data-testid="where">{useLocation().pathname}</output>
}

function renderScreen(): void {
  // The voice section's calls come from the fake; no X account is connected.
  window.opencat = {
    ...fakeApi().api,
    app: { getOpenAtLogin, setOpenAtLogin },
    locale: { weekStart: vi.fn().mockResolvedValue(0) },
    settings: {
      get: vi.fn((key: string) => Promise.resolve(settings.get(key) ?? null)),
      set: vi.fn((key: string, value: unknown) => {
        settings.set(key, value)
        return Promise.resolve()
      })
    }
  } as unknown as typeof window.opencat
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>
  )
}

const loginSwitch = (): HTMLButtonElement =>
  screen.getByRole<HTMLButtonElement>('switch', { name: 'Start OpenCatt at login' })

beforeEach(() => {
  // The switch only works in the installed app; tests play that build.
  vi.stubEnv('DEV', false)
  getOpenAtLogin = vi.fn().mockResolvedValue(false)
  setOpenAtLogin = vi.fn().mockResolvedValue(undefined)
  settings = new Map()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('SettingsScreen, start at login', () => {
  it('shows whether OpenCatt starts at login', async () => {
    getOpenAtLogin.mockResolvedValue(true)
    renderScreen()
    await waitFor(() => expect(loginSwitch().getAttribute('aria-checked')).toBe('true'))
    expect(loginSwitch().disabled).toBe(false)
    expect(screen.getByText(/Keeps scheduled posts going out/)).toBeTruthy()
  })

  it('turns it on and off', async () => {
    renderScreen()
    await waitFor(() => expect(loginSwitch().disabled).toBe(false))
    expect(loginSwitch().getAttribute('aria-checked')).toBe('false')
    fireEvent.click(loginSwitch())
    expect(loginSwitch().getAttribute('aria-checked')).toBe('true')
    expect(setOpenAtLogin).toHaveBeenLastCalledWith(true)
    await waitFor(() => expect(loginSwitch().disabled).toBe(false))
    fireEvent.click(loginSwitch())
    expect(loginSwitch().getAttribute('aria-checked')).toBe('false')
    expect(setOpenAtLogin).toHaveBeenLastCalledWith(false)
  })

  it('waits for one change before taking the next, so a late failure cannot undo a newer click', async () => {
    let fail: (err: Error) => void = () => {}
    setOpenAtLogin.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
    renderScreen()
    await waitFor(() => expect(loginSwitch().disabled).toBe(false))
    fireEvent.click(loginSwitch())
    expect(loginSwitch().disabled).toBe(true)
    fireEvent.click(loginSwitch())
    expect(setOpenAtLogin).toHaveBeenCalledTimes(1)
    fail(new Error('Not allowed'))
    await waitFor(() => expect(loginSwitch().disabled).toBe(false))
    expect(loginSwitch().getAttribute('aria-checked')).toBe('false')
  })

  it('says a start at login opens in the tray (OP-68)', async () => {
    renderScreen()
    await waitFor(() => expect(getOpenAtLogin).toHaveBeenCalled())
    expect(screen.getByText(/OpenCatt starts in the tray\./)).toBeTruthy()
  })

  it('flips back and says why when the change fails', async () => {
    setOpenAtLogin.mockRejectedValue(
      new Error("Error invoking remote method 'app:setOpenAtLogin': Error: Not allowed")
    )
    renderScreen()
    await waitFor(() => expect(loginSwitch().disabled).toBe(false))
    fireEvent.click(loginSwitch())
    expect(loginSwitch().getAttribute('aria-checked')).toBe('true')
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not change this: Not allowed'
    )
    expect(loginSwitch().getAttribute('aria-checked')).toBe('false')
  })

  it('is off limits in a dev build', async () => {
    vi.stubEnv('DEV', true)
    renderScreen()
    await waitFor(() => expect(getOpenAtLogin).toHaveBeenCalled())
    expect(loginSwitch().disabled).toBe(true)
    expect(screen.getByText('Only in the installed app')).toBeTruthy()
    expect(screen.queryByText(/Keeps scheduled posts going out/)).toBeNull()
  })
})

describe('SettingsScreen, week start', () => {
  it('offers the system day, Monday and Sunday, and saves the choice', async () => {
    renderScreen()
    const select = screen.getByLabelText<HTMLSelectElement>('Week starts on')
    await waitFor(() => expect(select.options[0].textContent).toBe('Sunday first (system)'))
    expect(select.value).toBe('auto')
    fireEvent.change(select, { target: { value: 'monday' } })
    expect(select.value).toBe('monday')
    expect(settings.get('calendar.weekStartsOn')).toBe('monday')
    fireEvent.change(select, { target: { value: 'auto' } })
    expect(settings.get('calendar.weekStartsOn')).toBeNull()
  })

  it('shows the saved choice', async () => {
    settings.set('calendar.weekStartsOn', 'sunday')
    renderScreen()
    const select = screen.getByLabelText<HTMLSelectElement>('Week starts on')
    await waitFor(() => expect(select.value).toBe('sunday'))
  })
})

describe('SettingsScreen, links', () => {
  it('opens Integrations for the X accounts', () => {
    renderScreen()
    expect(screen.getByText('X accounts')).toBeTruthy()
    expect(screen.getByText('Connect, reconnect or remove accounts.')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Open Integrations' }))
    expect(screen.getByTestId('where').textContent).toBe('/integrations')
  })

  it('opens the X setup for the X app', () => {
    renderScreen()
    expect(screen.getByText('X app')).toBeTruthy()
    expect(screen.getByText('Your Client ID and callback, from first-time setup.')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Open setup' }))
    expect(screen.getByTestId('where').textContent).toBe('/setup')
  })

  it('asks the agent panel for its settings', () => {
    const listener = vi.fn()
    const stop = onOpenAgentSettings(listener)
    renderScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Open agent settings' }))
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
  })
})
