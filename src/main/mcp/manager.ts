import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { McpStatus } from '@shared/api'
import type { SettingsStore } from '../db'
import { MCP_PATH, MCP_PORT, type McpHttpServer } from './server'

const ENABLED_SETTING = 'mcp.enabled'

/** What the stdio bridge reads to find the running app. */
export interface McpConnection {
  url: string
  token: string
}

export interface McpPaths {
  /** userData/mcp.json */
  connectionFile: string
  /** The executable that runs the bridge as Node: OpenCatt itself, or Electron in dev. */
  exe: string
  /** out/main/mcp-bridge.js */
  bridge: string
  /** The server's port: MCP_PORT, or another one for an unpackaged build (OP-134). */
  port?: number
}

/** Turns the MCP server on and off and hands out the config clients need. */
export class McpManager {
  private error: string | null = null

  private get port(): number {
    return this.paths.port ?? MCP_PORT
  }

  constructor(
    private readonly server: McpHttpServer,
    private readonly settings: SettingsStore,
    private readonly paths: McpPaths
  ) {}

  /** The current token, made on first use and kept in the connection file. */
  token(): string {
    return this.read()?.token ?? this.write(newToken()).token
  }

  /** Starts the server when the user had it on. Called once at startup. */
  async restore(): Promise<void> {
    if (this.settings.get(ENABLED_SETTING) === true) await this.start()
  }

  async setEnabled(enabled: boolean): Promise<McpStatus> {
    this.settings.set(ENABLED_SETTING, enabled)
    if (enabled) await this.start()
    else {
      await this.server.stop()
      this.error = null
    }
    return this.status()
  }

  /** A new token. Every client configured with the old one has to be set up again. */
  regenerateToken(): McpStatus {
    this.write(newToken())
    return this.status()
  }

  async stop(): Promise<void> {
    await this.server.stop()
  }

  status(): McpStatus {
    const enabled = this.settings.get(ENABLED_SETTING) === true
    const base = { enabled, running: this.server.running, error: this.error, port: this.port }
    if (!enabled) return base
    const { url, token } = { url: this.url(), token: this.token() }
    return {
      ...base,
      claudeCode: `claude mcp add --transport http opencat ${url} --header "Authorization: Bearer ${token}"`,
      claudeDesktop: JSON.stringify(
        {
          mcpServers: {
            opencat: {
              command: this.paths.exe,
              args: [this.paths.bridge, this.paths.connectionFile],
              env: { ELECTRON_RUN_AS_NODE: '1' }
            }
          }
        },
        null,
        2
      )
    }
  }

  private url(): string {
    return `http://127.0.0.1:${this.port}${MCP_PATH}`
  }

  private async start(): Promise<void> {
    this.token()
    try {
      await this.server.start()
      this.error = null
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      this.error =
        code === 'EADDRINUSE'
          ? `Port ${this.port} is already in use by another app, so other agents can't connect. Close that app, then turn this off and on again.`
          : `The MCP server could not start: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  private read(): McpConnection | null {
    if (!existsSync(this.paths.connectionFile)) return null
    try {
      const value = JSON.parse(
        readFileSync(this.paths.connectionFile, 'utf8')
      ) as Partial<McpConnection>
      return typeof value.token === 'string' && value.token
        ? { url: this.url(), token: value.token }
        : null
    } catch {
      return null
    }
  }

  private write(token: string): McpConnection {
    const connection = { url: this.url(), token }
    // Only the user can read it: it is the key to scheduling posts.
    writeFileSync(this.paths.connectionFile, JSON.stringify(connection), { mode: 0o600 })
    return connection
  }
}

function newToken(): string {
  return randomBytes(32).toString('base64url')
}
