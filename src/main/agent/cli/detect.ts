import { execFile as nodeExecFile } from 'node:child_process'
import type { ClaudeCliStatus } from '@shared/api'
import { describeClaude, type ClaudeCommand } from './find'

const TIMEOUT_MS = 5000

/** Runs the CLI with some arguments and gives back its stdout, even when it exits non-zero. */
export type RunClaude = (
  found: ClaudeCommand,
  args: string[]
) => Promise<{ stdout: string; failed: boolean }>

/** The same way the runner starts it: no shell, the found command's prefix and env. */
export const runClaude: RunClaude = (found, args) =>
  new Promise((resolve, reject) => {
    nodeExecFile(
      found.command,
      [...found.prefix, ...args],
      { env: { ...process.env, ...found.env }, timeout: TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        const out = String(stdout ?? '')
        // Killed by the timeout or never started: nothing to read.
        if (err && (err.killed || !out.trim())) reject(err)
        else resolve({ stdout: out, failed: err !== null })
      }
    )
  })

const NOT_FOUND: ClaudeCliStatus = {
  found: false,
  path: null,
  version: null,
  loggedIn: false,
  plan: null,
  error: null
}

/**
 * Finds the claude CLI, then asks it for its version and whether it is logged in. Nothing here
 * costs tokens: `auth status` only reads the local login.
 */
export async function detectClaude(
  find: () => ClaudeCommand | null,
  run: RunClaude = runClaude
): Promise<ClaudeCliStatus> {
  const found = find()
  if (!found) return NOT_FOUND
  const status: ClaudeCliStatus = { ...NOT_FOUND, found: true, path: describeClaude(found) }

  const [version, auth] = await Promise.allSettled([
    run(found, ['--version']),
    run(found, ['auth', 'status', '--json'])
  ])
  if (version.status === 'fulfilled') {
    status.version = /\d+\.\d+\.\d+/.exec(version.value.stdout)?.[0] ?? null
  }
  if (auth.status === 'rejected') {
    status.error = `Claude Code didn't answer: ${messageOf(auth.reason)}`
    return status
  }
  try {
    const parsed = JSON.parse(auth.value.stdout) as {
      loggedIn?: unknown
      subscriptionType?: unknown
    }
    status.loggedIn = parsed.loggedIn === true
    status.plan =
      status.loggedIn && typeof parsed.subscriptionType === 'string' && parsed.subscriptionType
        ? parsed.subscriptionType
        : null
  } catch {
    status.error = 'Claude Code gave an answer OpenCatt could not read. Update it and recheck.'
  }
  return status
}

const messageOf = (err: unknown): string =>
  err instanceof Error && 'killed' in err && err.killed
    ? `no answer in ${TIMEOUT_MS / 1000} seconds`
    : err instanceof Error
      ? err.message
      : String(err)
