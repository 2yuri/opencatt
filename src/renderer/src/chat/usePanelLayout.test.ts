import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { fakeApi } from '../test/fakeApi'
import { usePanelLayout } from './usePanelLayout'

afterEach(() => {
  cleanup()
})

function setup(room: { value: number }, saved: { open?: boolean; width?: number } = {}) {
  const fake = fakeApi([])
  if (saved.open !== undefined) fake.settings.set('chatPanel.open', saved.open)
  if (saved.width !== undefined) fake.settings.set('chatPanel.width', saved.width)
  window.opencat = fake.api
  const ref = { current: null }
  const hook = renderHook(() => usePanelLayout(ref, () => room.value))
  return { fake, hook }
}

const resize = (room: { value: number }, value: number): void =>
  act(() => {
    room.value = value
    window.dispatchEvent(new Event('resize'))
  })

describe('usePanelLayout', () => {
  it('restores the saved width and state, clamped to the room there is now', async () => {
    const room = { value: 1000 }
    const { hook } = setup(room, { open: true, width: 520 })
    await waitFor(() => expect(hook.result.current.width).toBe(460))
    expect(hook.result.current.open).toBe(true)

    resize(room, 2000)
    expect(hook.result.current.width).toBe(520)
  })

  it('collapses on a narrow window and opens again when there is room, without saving it', async () => {
    const room = { value: 2000 }
    const { hook, fake } = setup(room)
    await waitFor(() => expect(hook.result.current.open).toBe(true))

    resize(room, 800)
    expect(hook.result.current.open).toBe(false)
    expect(hook.result.current.squeezed).toBe(true)
    expect(fake.settings.get('chatPanel.open')).toBeUndefined()

    resize(room, 1400)
    expect(hook.result.current.open).toBe(true)
  })

  it('opens anyway from the rail on a narrow window, until the window has room again', async () => {
    const room = { value: 800 }
    const { hook } = setup(room)
    await waitFor(() => expect(hook.result.current.squeezed).toBe(true))

    act(() => hook.result.current.setOpen(true))
    expect(hook.result.current.open).toBe(true)
    expect(hook.result.current.width).toBe(300)

    resize(room, 1400)
    resize(room, 800)
    expect(hook.result.current.open).toBe(false)
  })
})
