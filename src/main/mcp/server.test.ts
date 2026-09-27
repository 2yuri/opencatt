import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { PostsService } from '../db'
import { openDatabase } from '../db/database'
import { postTools } from '../agent/tools'
import { McpHttpServer, mcpTools } from './server'

// Europe/Lisbon, +01:00 on this date.
const NOW = new Date('2026-09-26T20:00:00Z')
const TOKEN = 'test-token-0123456789'

let server: McpHttpServer | null = null

afterEach(async () => {
  await server?.stop()
  server = null
})

async function start(token = TOKEN): Promise<{ posts: PostsService; url: URL }> {
  const posts = new PostsService(openDatabase(':memory:'), () => NOW)
  server = new McpHttpServer({
    tools: mcpTools(
      postTools(posts, () => NOW),
      () => NOW
    ),
    token: () => token,
    port: 0
  })
  await server.start()
  return { posts, url: new URL(`http://127.0.0.1:${server.port}/mcp`) }
}

async function connect(url: URL, token = TOKEN): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } }
    })
  )
  return client
}

const textOf = (result: Awaited<ReturnType<Client['callTool']>>): string =>
  (result.content as { type: string; text: string }[])[0]!.text

describe('McpHttpServer', () => {
  it('lists only the tools outside agents may use', async () => {
    const { url } = await start()
    const client = await connect(url)
    expect(client.getInstructions()).toContain('wait for the user to approve them')
    expect(client.getInstructions()).toContain("You can't approve posts")
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual([
      'current_time',
      'create_posts',
      'list_posts',
      'reschedule_post'
    ])
    expect(tools.find((t) => t.name === 'create_posts')?.inputSchema.required).toEqual(['posts'])
    await client.close()
  })

  it('schedules posts through the same rules as the in-app agent', async () => {
    const { url, posts } = await start()
    const client = await connect(url)

    expect(
      JSON.parse(textOf(await client.callTool({ name: 'current_time', arguments: {} })))
    ).toMatchObject({
      now: '2026-09-26T21:00:00+01:00',
      weekday: 'Saturday',
      time_zone: 'Europe/Lisbon'
    })

    const created = await client.callTool({
      name: 'create_posts',
      arguments: { posts: [{ text: 'From Claude', scheduled_at: '2026-09-28T09:00:00+01:00' }] }
    })
    expect(created.isError).toBe(false)
    expect(posts.listByDay('2026-09-28').map((p) => [p.text, p.status])).toEqual([
      ['From Claude', 'pending_approval']
    ])

    const late = await client.callTool({
      name: 'create_posts',
      arguments: { posts: [{ text: 'Late', scheduled_at: '2020-01-01T09:00:00Z' }] }
    })
    expect(late.isError).toBe(true)
    expect(textOf(late)).toContain('in the past')
    await client.close()
  })

  it('refuses delete and update, which are not served', async () => {
    const { url, posts } = await start()
    const { id } = posts.create({ text: 'Keep me', scheduledAt: '2026-09-28T09:00:00+01:00' })
    const client = await connect(url)
    for (const name of ['delete_post', 'update_post']) {
      const out = await client.callTool({ name, arguments: { id, text: 'x' } })
      expect(out.isError).toBe(true)
      expect(textOf(out)).toContain('Unknown tool')
    }
    expect(posts.get(id)?.text).toBe('Keep me')
    await client.close()
  })

  it('rejects a missing or wrong token, a foreign Host and a foreign Origin', async () => {
    const { url } = await start()
    const init = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    const post = (headers: Record<string, string>) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers
        },
        body: JSON.stringify(init)
      })

    expect((await post({})).status).toBe(401)
    expect((await post({ authorization: 'Bearer nope' })).status).toBe(401)
    expect(
      (await post({ authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example' })).status
    ).toBe(403)
    await expect(connect(url, 'wrong')).rejects.toThrow()

    // fetch won't let us set Host, so ask the server directly with a rebinding-style Host.
    const { request } = await import('node:http')
    const status = await new Promise<number>((resolve) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: url.port,
          path: '/mcp',
          method: 'POST',
          headers: { host: 'evil.example', authorization: `Bearer ${TOKEN}` }
        },
        (res) => resolve(res.statusCode ?? 0)
      )
      req.end('{}')
    })
    expect(status).toBe(403)
  })

  it('stops listening on stop, and says so when the port is taken', async () => {
    const { url } = await start()
    const other = new McpHttpServer({ tools: [], token: () => TOKEN, port: Number(url.port) })
    await expect(other.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
    await server!.stop()
    expect(server!.running).toBe(false)
    await expect(fetch(url, { method: 'POST' })).rejects.toThrow()
  })
})
