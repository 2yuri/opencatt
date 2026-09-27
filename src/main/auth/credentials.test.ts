import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CredentialStore, SecureStorageUnavailableError, type Cipher } from './credentials'

// Reverses the bytes: enough to prove nothing is written in plain text.
function fakeCipher(available = true): Cipher {
  return {
    isAvailable: () => available,
    encrypt: (plain) => Buffer.from(plain).reverse(),
    decrypt: (data) => Buffer.from(data).reverse().toString()
  }
}

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'opencat-creds-')), 'x-credentials.bin')
}

describe('CredentialStore', () => {
  it('keeps entries encrypted on disk and reads them back', () => {
    const path = tempFile()
    const store = new CredentialStore(path, fakeCipher())
    store.set('oauth1', { apiKey: 'secret-api-key' })
    store.set('oauth2', { refreshToken: 'secret-refresh' })

    expect(readFileSync(path).toString()).not.toContain('secret-api-key')
    const again = new CredentialStore(path, fakeCipher())
    expect(again.get('oauth1')).toEqual({ apiKey: 'secret-api-key' })
    expect(again.has('oauth2')).toBe(true)
    expect(again.get('missing')).toBeNull()
  })

  it('removes the file once the last entry is deleted', () => {
    const path = tempFile()
    const store = new CredentialStore(path, fakeCipher())
    store.set('oauth1', { apiKey: 'k' })
    store.set('oauth2', { token: 't' })
    store.delete('oauth1')
    expect(store.has('oauth1')).toBe(false)
    expect(store.has('oauth2')).toBe(true)
    store.delete('oauth2')
    expect(existsSync(path)).toBe(false)
  })

  it('refuses to write anything without real encryption', () => {
    const path = tempFile()
    const store = new CredentialStore(path, fakeCipher(false))
    expect(store.isAvailable()).toBe(false)
    expect(() => store.set('oauth1', { apiKey: 'k' })).toThrow(SecureStorageUnavailableError)
    expect(() => store.set('oauth1', { apiKey: 'k' })).toThrow(/GNOME Keyring or KWallet/)
    expect(existsSync(path)).toBe(false)
    expect(store.get('oauth1')).toBeNull()
  })

  it('treats a file it can no longer decrypt as empty, and lets a new save replace it', () => {
    const path = tempFile()
    new CredentialStore(path, fakeCipher()).set('oauth1', { apiKey: 'old' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken: Cipher = {
      ...fakeCipher(),
      decrypt: () => {
        throw new Error(
          'Error while decrypting the ciphertext provided to safeStorage.decryptString.'
        )
      }
    }
    const store = new CredentialStore(path, broken)

    expect(store.get('oauth1')).toBeNull()
    expect(store.has('oauth1')).toBe(false)
    expect(warn).toHaveBeenCalled()
    store.set('oauth1', { apiKey: 'new' })
    expect(new CredentialStore(path, fakeCipher()).get('oauth1')).toEqual({ apiKey: 'new' })
    warn.mockRestore()
  })
})
