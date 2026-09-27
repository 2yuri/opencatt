import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

export interface ClaudeCommand {
  /** What to spawn. */
  command: string
  /** Put before the CLI's own arguments. */
  prefix: string[]
  env?: Record<string, string>
}

interface FindOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  home?: string
  exists?: (path: string) => boolean
  /** The app's own executable, to run npm's cli.js as Node on Windows. */
  execPath?: string
}

/**
 * Finds the claude CLI. A GUI app on macOS doesn't get the shell's PATH, so the usual install
 * folders are searched too. On Windows, npm installs a claude.cmd shim that can only run through
 * a shell; rather than pass the user's text through cmd.exe, the shim's cli.js is run directly
 * on OpenCatt's own executable as Node.
 */
export function findClaude(options: FindOptions = {}): ClaudeCommand | null {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const home = options.home ?? homedir()
  const exists = options.exists ?? existsSync
  const win = platform === 'win32'
  const join_ = win ? (...p: string[]) => p.join('\\') : join

  const dirs = [
    ...(env['PATH'] ?? env['Path'] ?? '').split(win ? ';' : delimiter).filter(Boolean),
    ...(win
      ? [
          join_(home, '.local', 'bin'),
          ...(env['APPDATA'] ? [join_(env['APPDATA'], 'npm')] : []),
          ...(env['LOCALAPPDATA'] ? [join_(env['LOCALAPPDATA'], 'Programs', 'claude')] : [])
        ]
      : [
          join(home, '.local', 'bin'),
          join(home, '.claude', 'local'),
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin'
        ])
  ]

  for (const dir of dirs) {
    if (win) {
      const exe = join_(dir, 'claude.exe')
      if (exists(exe)) return { command: exe, prefix: [] }
      const shim = join_(dir, 'claude.cmd')
      const script = join_(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
      if (exists(shim) && exists(script)) {
        return {
          command: options.execPath ?? process.execPath,
          prefix: [script],
          env: { ELECTRON_RUN_AS_NODE: '1' }
        }
      }
    } else {
      const bin = join(dir, 'claude')
      if (exists(bin)) return { command: bin, prefix: [] }
    }
  }
  return null
}

/** For messages: where a found CLI lives. */
export const describeClaude = (found: ClaudeCommand): string =>
  found.prefix[0] ? dirname(found.prefix[0]) : found.command
