import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** The data folder builds from before the rename (OP-52) used, next to OpenCatt's. */
export const LEGACY_FOLDER = 'OpenCat'
const DATABASE = 'opencat.db'
/** Chromium's single-instance lock files: stale in the old folder, never worth moving. */
const LOCK_FILES = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket'])

export type LegacyMove = { moved: string[]; skipped: string[] } | null

/**
 * Moves a pre-rename OpenCat data folder into OpenCatt's, once (OP-100). It only moves when the
 * old folder has a database and the new one doesn't, so it never runs twice and never touches a
 * profile the user already has in OpenCatt. Entries that already exist in the new folder are
 * left where they are rather than overwritten. Must run before anything opens files in userData,
 * which means before `requestSingleInstanceLock`: the folder is still empty then.
 */
export function moveLegacyUserData(appData: string, userData: string): LegacyMove {
  const legacy = join(appData, LEGACY_FOLDER)
  if (!existsSync(join(legacy, DATABASE)) || existsSync(join(userData, DATABASE))) return null
  // macOS and Windows folders ignore case: never "move" a folder into itself.
  if (legacy.toLowerCase() === userData.toLowerCase()) return null

  mkdirSync(userData, { recursive: true })
  const moved: string[] = []
  const skipped: string[] = []
  for (const name of readdirSync(legacy)) {
    if (LOCK_FILES.has(name)) continue
    const target = join(userData, name)
    if (existsSync(target)) {
      skipped.push(name)
      continue
    }
    renameSync(join(legacy, name), target)
    moved.push(name)
  }
  // Remove the old folder only when nothing but stale lock files is left in it.
  try {
    if (readdirSync(legacy).every((name) => LOCK_FILES.has(name))) {
      rmSync(legacy, { recursive: true })
    }
  } catch {
    // A leftover folder is harmless: the database has moved, so this never runs again.
  }
  return { moved, skipped }
}
