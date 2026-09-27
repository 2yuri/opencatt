import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { MCP_PORT } from '@shared/mcp'
import { callTool, localIso, type PostTool } from '../agent/tools'

export { MCP_PORT }
export const MCP_PATH = '/mcp'

/**
 * What outside agents may do: schedule, look, move. Editing and deleting stay in the app, so a
 * stray agent can't rewrite or wipe the calendar.
 */
export const MCP_TOOL_NAMES = [
  'create_posts',
  'list_posts',
  'reschedule_post',
  'list_accounts'
] as const

/** Outside agents don't know the user's clock, and times must carry the user's offset. */
export function currentTimeTool(now: () => Date = () => new Date()): PostTool {
  return {
    name: 'current_time',
    description:
      "The user's local date, time, weekday and time zone. Call it before scheduling, so times " +
      'you pass carry the right UTC offset.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    run() {
      const at = now()
      return {
        content: JSON.stringify({
          now: localIso(at),
          weekday: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(at),
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
      }
    }
  }
}

export function mcpTools(all: PostTool[], now: () => Date = () => new Date()): PostTool[] {
  const allowed: readonly string[] = MCP_TOOL_NAMES
  return [currentTimeTool(now), ...all.filter((t) => allowed.includes(t.name))]
}

const INSTRUCTIONS =
  'OpenCatt schedules posts on X. Posts you create or move wait for the user to approve them in ' +
  "OpenCatt, and only approved posts go out at their time. You can't approve posts; tell the user " +
  'they are waiting for approval. Call current_time first, then create_posts with ISO times ' +
  "that carry the user's UTC offset."

/** One MCP server per request: the transport is stateless, so there is no session to keep. */
function mcpServer(tools: PostTool[], version: string): Server {
  const server = new Server(
    { name: 'opencat', version },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }))
  }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const out = await callTool(tools, request.params.name, request.params.arguments ?? {})
      return {
        content: [
          { type: 'text' as const, text: out.content },
          ...(out.image
            ? [{ type: 'image' as const, data: out.image.data, mimeType: out.image.mediaType }]
            : [])
        ],
        isError: out.isError
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true
      }
    }
  })
  return server
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

/** A web page can point a hostname at 127.0.0.1; only a local Host and no foreign Origin pass. */
function isLocalRequest(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (!LOCAL_HOSTS.has(host)) return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

function hasToken(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? ''
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '')
  const expected = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export interface McpHttpOptions {
  tools: PostTool[]
  /** Read on every request, so a regenerated token cuts old clients off at once. */
  token: () => string
  port?: number
  version?: string
}

/** The MCP endpoint on 127.0.0.1. Nothing listens until start(). */
export class McpHttpServer {
  private http: HttpServer | null = null

  constructor(private readonly options: McpHttpOptions) {}

  get running(): boolean {
    return this.http?.listening ?? false
  }

  get port(): number {
    const address = this.http?.address()
    return typeof address === 'object' && address ? address.port : (this.options.port ?? MCP_PORT)
  }

  /** Rejects with the listen error, e.g. EADDRINUSE when another app holds the port. */
  async start(): Promise<void> {
    if (this.http) return
    const http = createServer((req, res) => {
      const reply = (status: number, error: string): void => {
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error }))
      }
      if (!isLocalRequest(req)) return reply(403, 'Only local clients may connect')
      if (new URL(req.url ?? '/', 'http://localhost').pathname !== MCP_PATH) {
        return reply(404, 'Not found')
      }
      if (!hasToken(req, this.options.token())) return reply(401, 'Missing or wrong bearer token')
      if (req.method !== 'POST') return reply(405, 'Use POST')

      const server = mcpServer(this.options.tools, this.options.version ?? '0.0.0')
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      res.on('close', () => {
        void transport.close()
        void server.close()
      })
      server
        .connect(transport)
        .then(() => transport.handleRequest(req, res))
        .catch((err: unknown) => {
          if (!res.headersSent) reply(500, err instanceof Error ? err.message : String(err))
        })
    })
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject)
      http.listen(this.options.port ?? MCP_PORT, '127.0.0.1', () => {
        http.off('error', reject)
        resolve()
      })
    })
    this.http = http
  }

  async stop(): Promise<void> {
    const http = this.http
    this.http = null
    if (!http) return
    http.closeAllConnections()
    await new Promise<void>((resolve) => http.close(() => resolve()))
  }
}
