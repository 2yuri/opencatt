import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ Menu: {}, Notification: {}, Tray: class {}, nativeImage: {} }))

const { onLastWindowClosed } = await import('./tray')

describe('onLastWindowClosed (OP-107)', () => {
  const run = (platform: NodeJS.Platform, quitting = false) => {
    const tellOnce = vi.fn()
    const hideDock = vi.fn()
    onLastWindowClosed({ quitting, platform, tellOnce, hideDock })
    return { tellOnce, hideDock }
  }

  it('on macOS, says once it is still running and leaves the Dock and Cmd-Tab', () => {
    const { tellOnce, hideDock } = run('darwin')
    expect(tellOnce).toHaveBeenCalledTimes(1)
    expect(hideDock).toHaveBeenCalledTimes(1)
  })

  it('on Windows and Linux, only says it is still running', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const { tellOnce, hideDock } = run(platform)
      expect(tellOnce).toHaveBeenCalledTimes(1)
      expect(hideDock).not.toHaveBeenCalled()
    }
  })

  it('does nothing while quitting', () => {
    const { tellOnce, hideDock } = run('darwin', true)
    expect(tellOnce).not.toHaveBeenCalled()
    expect(hideDock).not.toHaveBeenCalled()
  })
})
