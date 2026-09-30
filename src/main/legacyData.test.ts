import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { moveLegacyUserData } from './legacyData'

let appData: string
let oldDir: string
let newDir: string

const put = (dir: string, name: string, text: string): void => {
  mkdirSync(join(dir, name, '..'), { recursive: true })
  writeFileSync(join(dir, name), text)
}
const read = (dir: string, name: string): string => readFileSync(join(dir, name), 'utf8')

beforeEach(() => {
  appData = mkdtempSync(join(tmpdir(), 'opencat-appdata-'))
  oldDir = join(appData, 'OpenCat')
  newDir = join(appData, 'OpenCatt')
})
afterEach(() => rmSync(appData, { recursive: true, force: true }))

describe('moveLegacyUserData (OP-100)', () => {
  it('moves everything from OpenCat into OpenCatt when only the old folder has data', () => {
    put(oldDir, 'opencat.db', 'old db')
    put(oldDir, 'opencat.db-wal', 'wal')
    put(oldDir, 'x-credentials.bin', 'secret')
    put(oldDir, 'Local State', '{"os_crypt":{}}')
    put(oldDir, 'media/a.png', 'png')
    put(oldDir, 'SingletonLock', 'stale')

    const result = moveLegacyUserData(appData, newDir)

    expect(result?.moved.sort()).toEqual(
      ['Local State', 'media', 'opencat.db', 'opencat.db-wal', 'x-credentials.bin'].sort()
    )
    expect(read(newDir, 'opencat.db')).toBe('old db')
    expect(read(newDir, 'x-credentials.bin')).toBe('secret')
    expect(read(newDir, 'media/a.png')).toBe('png')
    expect(existsSync(join(newDir, 'SingletonLock'))).toBe(false)
    // Nothing but the stale lock was left, so the old folder is gone.
    expect(existsSync(oldDir)).toBe(false)
  })

  it('moves into an OpenCatt folder that exists but is still empty, as it is at startup', () => {
    put(oldDir, 'opencat.db', 'old db')
    mkdirSync(newDir)
    expect(moveLegacyUserData(appData, newDir)?.moved).toEqual(['opencat.db'])
    expect(read(newDir, 'opencat.db')).toBe('old db')
  })

  it('moves nothing when both folders have a database', () => {
    put(oldDir, 'opencat.db', 'old db')
    put(oldDir, 'media/a.png', 'old png')
    put(newDir, 'opencat.db', 'new db')

    expect(moveLegacyUserData(appData, newDir)).toBeNull()
    expect(read(newDir, 'opencat.db')).toBe('new db')
    expect(read(oldDir, 'opencat.db')).toBe('old db')
    expect(existsSync(join(newDir, 'media'))).toBe(false)
  })

  it('does nothing when only OpenCatt exists, or neither does', () => {
    expect(moveLegacyUserData(appData, newDir)).toBeNull()
    expect(readdirSync(appData)).toEqual([])

    put(newDir, 'opencat.db', 'new db')
    expect(moveLegacyUserData(appData, newDir)).toBeNull()
    expect(existsSync(oldDir)).toBe(false)
  })

  it('does nothing when the old folder has no database', () => {
    put(oldDir, 'Cookies', 'c')
    expect(moveLegacyUserData(appData, newDir)).toBeNull()
    expect(existsSync(join(newDir, 'Cookies'))).toBe(false)
  })

  it('never overwrites what OpenCatt already holds, and keeps the old folder when it skipped', () => {
    put(oldDir, 'opencat.db', 'old db')
    put(oldDir, 'Local State', 'old state')
    put(newDir, 'Local State', 'new state')

    const result = moveLegacyUserData(appData, newDir)

    expect(result).toEqual({ moved: ['opencat.db'], skipped: ['Local State'] })
    expect(read(newDir, 'Local State')).toBe('new state')
    expect(read(oldDir, 'Local State')).toBe('old state')
  })

  it('never moves a folder into itself when the names differ only in case', () => {
    put(oldDir, 'opencat.db', 'old db')
    expect(moveLegacyUserData(appData, join(appData, 'opencat'))).toBeNull()
    expect(read(oldDir, 'opencat.db')).toBe('old db')
  })
})
