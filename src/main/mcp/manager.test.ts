import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../db'
import { openDatabase } from '../db/database'
import { McpManager } from './manager'
import { McpHttpServer } from './server'

const managers: McpManager[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map((m) => m.stop()))
})

function setup(port = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'opencat-mcp-'))
  const settings = new SettingsStore(openDatabase(':memory:'))
  const connectionFile = join(dir, 'mcp.json')
  const server = new McpHttpServer({ tools: [], token: () => manager.token(), port })
  const manager: McpManager = new McpManager(server, settings, {
    connectionFile,
    exe: '/Applications/OpenCatt.app/Contents/MacOS/OpenCatt',
    bridge: '/Applications/OpenCatt.app/Contents/Resources/app.asar/out/main/mcp-bridge.js'
  })
  managers.push(manager)
  return { manager, server, settings, connectionFile }
}

describe('McpManager', () => {
  it('is off by default and starts only when turned on', async () => {
    const { manager, server } = setup()
    await manager.restore()
    expect(manager.status()).toEqual({ enabled: false, running: false, error: null })
    expect(server.running).toBe(false)

    const on = await manager.setEnabled(true)
    expect(on).toMatchObject({ enabled: true, running: true, error: null })
    expect(on.claudeCode).toMatch(
      /^claude mcp add --transport http opencat http:\/\/127\.0\.0\.1:47824\/mcp --header "Authorization: Bearer [\w-]{43}"$/
    )
    expect(JSON.parse(on.claudeDesktop!)).toEqual({
      mcpServers: {
        opencat: {
          command: '/Applications/OpenCatt.app/Contents/MacOS/OpenCatt',
          args: [
            '/Applications/OpenCatt.app/Contents/Resources/app.asar/out/main/mcp-bridge.js',
            expect.stringMatching(/mcp\.json$/)
          ],
          env: { ELECTRON_RUN_AS_NODE: '1' }
        }
      }
    })

    expect((await manager.setEnabled(false)).running).toBe(false)
  })

  it('keeps the token in a file only the user can read, and regenerates it', async () => {
    const { manager, connectionFile } = setup()
    const first = manager.token()
    expect(JSON.parse(readFileSync(connectionFile, 'utf8'))).toEqual({
      url: 'http://127.0.0.1:47824/mcp',
      token: first
    })
    if (process.platform !== 'win32') expect(statSync(connectionFile).mode & 0o777).toBe(0o600)
    expect(manager.token()).toBe(first)

    manager.regenerateToken()
    expect(manager.token()).not.toBe(first)

    writeFileSync(connectionFile, 'not json')
    expect(manager.token()).toMatch(/^[\w-]{43}$/)
  })

  it('restores the server after a restart when it was on', async () => {
    const { manager, settings } = setup()
    settings.set('mcp.enabled', true)
    await manager.restore()
    expect(manager.status().running).toBe(true)
  })

  it('explains a port that is taken instead of failing quietly', async () => {
    const holder = setup()
    await holder.manager.setEnabled(true)
    const port = holder.server.port
    const { manager } = setup(port)
    const status = await manager.setEnabled(true)
    expect(status).toMatchObject({ enabled: true, running: false })
    expect(status.error).toContain('already in use')
  })
})
