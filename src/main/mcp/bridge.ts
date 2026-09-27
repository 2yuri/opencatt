/**
 * stdio → HTTP bridge for MCP clients that only launch commands, like Claude Desktop.
 * Run by OpenCatt's own executable as Node (ELECTRON_RUN_AS_NODE=1), so nothing else needs
 * installing:  <OpenCatt> out/main/mcp-bridge.js <userData>/mcp.json
 * It reads JSON-RPC messages, one per line, forwards each to the running app, and writes
 * every reply back as a line. It imports nothing from Electron.
 */
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

export const NOT_RUNNING = "OpenCatt isn't running. Open it and try again."

interface Connection {
  url: string
  token: string
}

type Message = { jsonrpc: '2.0'; id?: string | number | null; method?: string }

function readConnection(file: string): Connection | null {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<Connection>
    return value.url && value.token ? { url: value.url, token: value.token } : null
  } catch {
    return null
  }
}

/** Pulls the JSON-RPC messages out of an SSE body: every `data:` line is one message. */
export function sseMessages(body: string): unknown[] {
  return body
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((data) => data !== '')
    .map((data) => JSON.parse(data) as unknown)
}

/** Forwards one message; returns the replies to write, or an error reply when the app is away. */
export async function forward(
  message: Message,
  connectionFile: string,
  doFetch: typeof fetch = fetch
): Promise<unknown[]> {
  const fail = (text: string): unknown[] =>
    message.id === undefined
      ? []
      : [{ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: text } }]

  // Read on every message, so a new token or a restarted app is picked up without relaunching.
  const connection = readConnection(connectionFile)
  if (!connection) return fail(NOT_RUNNING)

  let res: Response
  try {
    res = await doFetch(connection.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${connection.token}`
      },
      body: JSON.stringify(message)
    })
  } catch {
    return fail(NOT_RUNNING)
  }

  if (res.status === 401)
    return fail('OpenCatt refused the token. Copy the config from OpenCatt settings again.')
  if (res.status === 202) return []
  const body = await res.text()
  if (!res.ok) return fail(`OpenCatt answered ${res.status}: ${body}`)
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream'))
    return sseMessages(body)
  return body.trim() ? [JSON.parse(body) as unknown] : []
}

async function main(): Promise<void> {
  const file = process.argv[2]
  if (!file) {
    process.stderr.write('Usage: mcp-bridge.js <path to mcp.json>\n')
    process.exit(2)
  }
  const out = (value: unknown): void => void process.stdout.write(`${JSON.stringify(value)}\n`)
  // Replies go out in the order requests came in.
  let queue = Promise.resolve()
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue
    let message: Message
    try {
      message = JSON.parse(line) as Message
    } catch {
      out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      continue
    }
    queue = queue.then(async () => (await forward(message, file)).forEach(out))
  }
  await queue
}

if (require.main === module) void main()
