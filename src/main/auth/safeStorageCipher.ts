import { safeStorage } from 'electron'
import type { Cipher } from './credentials'

/**
 * Electron's safeStorage: Keychain on macOS, DPAPI on Windows, the Secret Service or KWallet on Linux.
 * On Linux without a keyring it falls back to a hard-coded key ("basic_text"), which we treat as no
 * encryption at all. Only valid after app 'ready'.
 */
export const safeStorageCipher: Cipher = {
  isAvailable() {
    if (!safeStorage.isEncryptionAvailable()) return false
    if (process.platform !== 'linux') return true
    const backend = safeStorage.getSelectedStorageBackend()
    return backend !== 'basic_text' && backend !== 'unknown'
  },
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (data) => safeStorage.decryptString(data)
}
