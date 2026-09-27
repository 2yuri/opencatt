import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { PostsService } from '../db'
import { openDatabase } from '../db/database'
import { postTools } from '../agent/tools'
import { NOT_RUNNING, forward, sseMessages } from './bridge'
import { McpHttpServer, mcpTools } from './server'

const TOKEN = 'bridge-token-0123456789'
let server: McpHttpServer | null = null
afterEach(async () => {
  await server?.stop()
  server = null
})

function connectionFile(url: string, token = TOKEN): string {
  const file = join(mkdtempSync(join(tmpdir(), 'opencat-bridge-')), 'mcp.json')
  writeFileSync(file, JSON.stringify({ url, token }))
  return file
}

async function start(): Promise<{ posts: PostsService; url: string }> {
  const now = () => new Date('2026-09-26T20:00:00Z')
  const posts = new PostsService(openDatabase(':memory:'), now)
  server = new McpHttpServer({
    tools: mcpTools(postTools(posts, now), now),
    token: () => TOKEN,
    port: 0
  })
  await server.start()
  return { posts, url: `http://127.0.0.1:${server.port}/mcp` }
}

describe('bridge forward', () => {
  it('reads SSE data lines as messages', () => {
    expect(sseMessages('event: message\ndata: {"id":1}\n\ndata: {"id":2}\n')).toEqual([
      { id: 1 },
      { id: 2 }
    ])
  })

  it('answers requests with a clear error when the app is not running, and drops notifications', async () => {
    const file = connectionFile('http://127.0.0.1:9/mcp')
    expect(await forward({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, file)).toEqual([
      { jsonrpc: '2.0', id: 7, error: { code: -32000, message: NOT_RUNNING } }
    ])
    expect(await forward({ jsonrpc: '2.0', method: 'notifications/initialized' }, file)).toEqual([])
    expect(await forward({ jsonrpc: '2.0', id: 8 }, '/no/such/mcp.json')).toMatchObject([
      { error: { message: NOT_RUNNING } }
    ])
  })

  it('says the token is refused rather than "not running"', async () => {
    const { url } = await start()
    const [reply] = await forward(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      connectionFile(url, 'old')
    )
    expect(JSON.stringify(reply)).toContain('refused the token')
  })
})

// The built bridge, run the way Claude Desktop runs it: the Electron binary as Node, over stdio.
const electron = (() => {
  try {
    return execFileSync(process.execPath, ['-e', "process.stdout.write(require('electron'))"], {
      cwd: resolve(__dirname, '../../..')
    }).toString()
  } catch {
    return ''
  }
})()
const bridge = resolve(__dirname, '../../../out/main/mcp-bridge.js')

describe.skipIf(!existsSync(bridge) || !existsSync(electron))('built bridge over stdio', () => {
  it('lets an MCP client schedule a post through the running app', async () => {
    const { url, posts } = await start()
    const client = new Client({ name: 'desktop-like', version: '1.0.0' })
    await client.connect(
      new StdioClientTransport({
        command: electron,
        args: [bridge, connectionFile(url)],
        env: { ELECTRON_RUN_AS_NODE: '1' }
      })
    )
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('create_posts')
    const out = await client.callTool({
      name: 'create_posts',
      arguments: { posts: [{ text: 'Via the bridge', scheduled_at: '2026-09-28T09:00:00+01:00' }] }
    })
    expect(out.isError).toBe(false)
    expect(posts.listByDay('2026-09-28').map((p) => p.text)).toEqual(['Via the bridge'])
    await client.close()
  }, 20_000)
})
