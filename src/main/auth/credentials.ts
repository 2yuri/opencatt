import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

/** What encrypts the credentials file. In the app it is Electron's safeStorage; tests pass a fake. */
export interface Cipher {
  /** False when the OS gives us no real encryption, e.g. Linux without a keyring. */
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export class SecureStorageUnavailableError extends Error {
  constructor() {
    super(
      'Your system has no keyring to keep your X keys safe. Install and unlock GNOME Keyring or KWallet, then restart OpenCatt.'
    )
    this.name = 'SecureStorageUnavailableError'
  }
}

type Entries = Record<string, unknown>

/**
 * Every X secret (OAuth 1.0a keys now, OAuth 2.0 tokens from OP-5) as one encrypted JSON file.
 * Nothing is written when the cipher is not available, so a secret never lands on disk in plain text.
 */
export class CredentialStore {
  constructor(
    private readonly path: string,
    private readonly cipher: Cipher
  ) {}

  isAvailable(): boolean {
    return this.cipher.isAvailable()
  }

  get<T>(name: string): T | null {
    const value = this.read()[name]
    return value === undefined ? null : (value as T)
  }

  has(name: string): boolean {
    return this.get(name) !== null
  }

  set(name: string, value: unknown): void {
    this.write({ ...this.read(), [name]: value })
  }

  delete(name: string): void {
    const entries = this.read()
    if (!(name in entries)) return
    delete entries[name]
    if (Object.keys(entries).length === 0) rmSync(this.path, { force: true })
    else this.write(entries)
  }

  private read(): Entries {
    if (!existsSync(this.path) || !this.cipher.isAvailable()) return {}
    try {
      return JSON.parse(this.cipher.decrypt(readFileSync(this.path))) as Entries
    } catch (err) {
      // userData restored on another machine, or the keychain item was reset: the file can't be
      // read any more. Treat it as empty so onboarding asks for the keys again; the next save
      // replaces it.
      console.warn(`Could not read ${this.path}, treating stored X credentials as missing:`, err)
      return {}
    }
  }

  private write(entries: Entries): void {
    if (!this.cipher.isAvailable()) throw new SecureStorageUnavailableError()
    // Write then rename, so a crash mid-write never leaves a half file behind.
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, this.cipher.encrypt(JSON.stringify(entries)), { mode: 0o600 })
    renameSync(tmp, this.path)
  }
}
