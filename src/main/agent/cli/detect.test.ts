import { describe, expect, it, vi } from 'vitest'
import { detectClaude, type RunClaude } from './detect'
import type { ClaudeCommand } from './find'

const FOUND: ClaudeCommand = { command: '/home/me/.local/bin/claude', prefix: [] }

const answers =
  (auth: Awaited<ReturnType<RunClaude>> | Error, version = '2.1.283 (Claude Code)\n'): RunClaude =>
  async (_found, args) => {
    if (args[0] === '--version') return { stdout: version, failed: false }
    if (auth instanceof Error) throw auth
    return auth
  }

describe('detectClaude', () => {
  it('runs nothing when the CLI is not found', async () => {
    const run = vi.fn<RunClaude>()
    expect(await detectClaude(() => null, run)).toEqual({
      found: false,
      path: null,
      version: null,
      loggedIn: false,
      plan: null,
      error: null
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('reads the version, the login and the plan, and leaves out the email', async () => {
    const auth = JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      email: 'me@example.com',
      subscriptionType: 'max'
    })
    const run = vi.fn(answers({ stdout: auth, failed: false }))
    const status = await detectClaude(() => FOUND, run)
    expect(status).toEqual({
      found: true,
      path: '/home/me/.local/bin/claude',
      version: '2.1.283',
      loggedIn: true,
      plan: 'max',
      error: null
    })
    expect(JSON.stringify(status)).not.toContain('me@example.com')
    expect(run).toHaveBeenCalledWith(FOUND, ['auth', 'status', '--json'])
  })

  it('reads a logged-out answer even when the CLI exits non-zero', async () => {
    const run = answers({ stdout: '{"loggedIn": false}', failed: true })
    expect(await detectClaude(() => FOUND, run)).toMatchObject({
      found: true,
      loggedIn: false,
      plan: null,
      error: null
    })
  })

  it('says why when the CLI does not answer', async () => {
    const timeout = Object.assign(new Error('killed'), { killed: true })
    expect(await detectClaude(() => FOUND, answers(timeout))).toMatchObject({
      found: true,
      version: '2.1.283',
      loggedIn: false,
      error: "Claude Code didn't answer: no answer in 5 seconds"
    })
    expect(
      (await detectClaude(() => FOUND, answers({ stdout: 'Usage: claude', failed: true }))).error
    ).toContain('could not read')
  })

  it('shows the folder of the script when the CLI runs on OpenCatt itself', async () => {
    const windows: ClaudeCommand = {
      command: 'C:\\OpenCatt\\OpenCatt.exe',
      prefix: ['C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    }
    const run = vi.fn(answers({ stdout: '{"loggedIn": true}', failed: false }))
    await detectClaude(() => windows, run)
    expect(run).toHaveBeenCalledWith(windows, ['--version'])
  })
})
