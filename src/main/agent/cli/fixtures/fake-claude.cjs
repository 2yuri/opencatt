// Stands in for the claude CLI in tests. It speaks the same stream-json, and in "tool" mode
// really calls OpenCatt's MCP endpoint from the --mcp-config it was given.
const { readFileSync, writeFileSync } = require('node:fs')

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const mode = process.env.FAKE_MODE || 'text'
const session = flag('--resume') || flag('--session-id')
const emit = (e) => process.stdout.write(JSON.stringify({ ...e, session_id: session }) + '\n')
const text = (t) =>
  emit({
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }
  })
const result = (r, isError = false) =>
  emit({
    type: 'result',
    subtype: 'success',
    is_error: isError,
    result: r,
    api_error_status: isError ? 401 : null
  })

async function main() {
  let prompt = ''
  for await (const chunk of process.stdin) prompt += chunk
  if (process.env.FAKE_RECORD) {
    const seen = JSON.parse(
      (() => {
        try {
          return readFileSync(process.env.FAKE_RECORD, 'utf8')
        } catch {
          return '[]'
        }
      })()
    )
    seen.push({ args, prompt })
    writeFileSync(process.env.FAKE_RECORD, JSON.stringify(seen))
  }

  if (mode === 'nosession' && flag('--resume')) {
    process.stderr.write(`No conversation found with session ID: ${session}\n`)
    process.exit(1)
  }
  emit({
    type: 'system',
    subtype: 'init',
    tools: [],
    mcp_servers: [{ name: 'opencat', status: 'connected' }]
  })

  if (mode === 'login') {
    emit({
      type: 'assistant',
      error: 'authentication_failed',
      message: { content: [{ type: 'text', text: 'Invalid API key · Please run /login' }] }
    })
    result('Invalid API key · Please run /login', true)
    process.exit(1)
  }
  if (mode === 'crash') {
    process.stderr.write('Segmentation fault\n')
    process.exit(139)
  }
  if (mode === 'hang') {
    text('Thinking about it')
    setInterval(() => {}, 1000)
    return
  }
  if (mode === 'tool') {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
    const {
      StreamableHTTPClientTransport
    } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
    const server = JSON.parse(readFileSync(flag('--mcp-config'), 'utf8')).mcpServers.opencat
    const client = new Client({ name: 'fake-claude', version: '0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers }
      })
    )
    text('On it. ')
    emit({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 't1', name: 'mcp__opencat__create_posts', input: {} }
      }
    })
    await client.callTool({
      name: 'create_posts',
      arguments: { posts: [{ text: 'From the CLI', scheduled_at: '2026-09-28T09:00:00+01:00' }] }
    })
    await client.close()
    text('Scheduled for Monday at 09:00.')
    result('On it. Scheduled for Monday at 09:00.')
    return
  }
  text('Hel')
  text('lo')
  result('Hello')
}

main().catch((err) => {
  process.stderr.write(String((err && err.stack) || err))
  process.exit(1)
})
