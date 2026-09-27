import { describe, expect, it } from 'vitest'
import { AuthError, authErrorMessage, tagAuthError, untagAuthError } from './authErrors'

describe('authErrorMessage', () => {
  it('has a message for each code auth.connect() rejects with', () => {
    const e = (code: string): Error => Object.assign(new Error('raw'), { code })
    expect(authErrorMessage(e('callback_mismatch'))).toContain('127.0.0.1:47823/callback')
    expect(authErrorMessage(e('cancelled'))).toBe(
      "Sign-in was cancelled. Try again when you're ready."
    )
    expect(authErrorMessage(e('timeout'))).toBe("X didn't answer in time. Try again.")
    expect(authErrorMessage(e('network'))).toBe(
      "Couldn't reach X. Check your connection and try again."
    )
  })

  it('falls back to the error text without the IPC prefix', () => {
    expect(
      authErrorMessage(new Error("Error invoking remote method 'auth:connect': Error: Nope"))
    ).toBe('Nope')
  })
})

describe('tagAuthError / untagAuthError', () => {
  it('carries the code across IPC, which keeps only the message', () => {
    const tagged = tagAuthError(new AuthError('timeout'))
    const overIpc = new Error(
      `Error invoking remote method 'auth:connect': Error: ${tagged.message}`
    )
    const back = untagAuthError(overIpc) as AuthError
    expect(back.code).toBe('timeout')
    expect(back.message).toBe("X didn't answer in time. Try again.")
    expect(authErrorMessage(back)).toBe("X didn't answer in time. Try again.")
  })

  it('leaves other errors alone', () => {
    const plain = new Error('Nope')
    expect(tagAuthError(plain)).toBe(plain)
    expect(untagAuthError(plain)).toBe(plain)
    expect(tagAuthError(new AuthError(null, 'Odd')).message).toBe('Odd')
  })
})
