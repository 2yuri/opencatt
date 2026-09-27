import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '@shared/api'
import { ChatStore, PostsService, SettingsStore } from '../../db'
import { openDatabase } from '../../db/database'
import { MediaStore } from '../../media/store'
import { fakeMedia, tempDir } from '../../media/testFiles'
import type { ImageLoader } from '../images'
import { AgentSession, type TurnAccount } from '../session'
import { postTools } from '../tools'
import { AgentMcpEndpoint } from './endpoint'
import { findClaude } from './find'
import { ClaudeCliRunner, cliArgs } from './runner'
import { parseCliLine } from './stream'

const NOW = new Date('2026-09-26T20:00:00Z')
const FAKE = resolve(__dirname, 'fixtures/fake-claude.cjs')
const endpoints: AgentMcpEndpoint[] = []

afterEach(async () => {
  delete process.env['FAKE_MODE']
  delete process.env['FAKE_RECORD']
  await Promise.all(endpoints.splice(0).map((e) => e.stop()))
})

function setup(
  options: {
    found?: boolean
    images?: ImageLoader
    account?: () => TurnAccount | null
    writing?: () => string | null
  } = {}
) {
  const db = openDatabase(':memory:')
  const media = new MediaStore(db, join(tempDir(), 'media'))
  const posts = new PostsService(db, () => NOW)
  const chat = new ChatStore(db, () => NOW)
  const settings = new SettingsStore(db)
  const tools = postTools(posts, () => NOW)
  const endpoint = new AgentMcpEndpoint(tools, () => NOW)
  endpoints.push(endpoint)
  const workDir = mkdtempSync(join(tmpdir(), 'opencat-cli-'))
  const record = join(workDir, 'record.json')
  process.env['FAKE_RECORD'] = record
  const runner = new ClaudeCliRunner({
    endpoint,
    allowedTools: AgentMcpEndpoint.toolNames(tools),
    find: () => (options.found === false ? null : { command: process.execPath, prefix: [FAKE] }),
    workDir,
    settings,
    images: options.images
  })
  const events: AgentEvent[] = []
  const session = new AgentSession(
    chat,
    runner,
    (e) => events.push(e),
    () => null,
    () => {},
    options.account,
    undefined,
    undefined,
    options.writing
  )
  const calls = (): { args: string[]; prompt: string }[] =>
    JSON.parse(readFileSync(record, 'utf8')) as { args: string[]; prompt: string }[]
  return { posts, chat, settings, events, session, calls, workDir, media }
}

describe('cliArgs', () => {
  it('gives the CLI no built-in tools and no MCP server but OpenCatt', () => {
    expect(
      cliArgs({
        mcpConfig: '/w/mcp-config.json',
        systemPrompt: '/w/system-prompt.txt',
        allowedTools: ['mcp__opencat__create_posts', 'mcp__opencat__list_posts'],
        session: { start: 's1' },
        model: null
      })
    ).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--tools',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      '/w/mcp-config.json',
      '--allowedTools',
      'mcp__opencat__create_posts,mcp__opencat__list_posts',
      '--permission-mode',
      'dontAsk',
      '--setting-sources',
      '',
      '--system-prompt-file',
      '/w/system-prompt.txt',
      '--session-id',
      's1'
    ])
  })
})

describe('parseCliLine on real CLI output', () => {
  it('finds the session, the text and the result, and ignores the rest', () => {
    const lines = readFileSync(resolve(__dirname, 'fixtures/text-reply.jsonl'), 'utf8')
      .trim()
      .split('\n')
    const events = lines.map((l) => parseCliLine(l, 'mcp__opencat__')).filter(Boolean)
    expect(events).toEqual([
      { kind: 'session', id: '11111111-2222-4333-8444-555555555555' },
      { kind: 'text', delta: 'hello there' },
      { kind: 'result', isError: false, text: 'hello there', status: null }
    ])
    expect(parseCliLine('not json', '')).toBeNull()
    expect(
      parseCliLine(
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_start',
            content_block: { type: 'tool_use', name: 'mcp__opencat__list_posts' }
          }
        }),
        'mcp__opencat__'
      )
    ).toEqual({ kind: 'tool', name: 'list_posts' })
  })
})

describe('ClaudeCliRunner with a fake claude', () => {
  it('streams the reply and resumes the same session on the next message', async () => {
    const { session, chat, calls, events } = setup()
    session.send('Hi')
    await session.idle
    expect(chat.list().map((m) => [m.role, m.content])).toEqual([
      ['user', 'Hi'],
      ['assistant', 'Hello']
    ])
    expect(
      events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta)
    ).toEqual(['Hel', 'lo'])

    session.send('Again')
    await session.idle
    const [first, second] = calls()
    const started = first!.args[first!.args.indexOf('--session-id') + 1]
    expect(second!.args[second!.args.indexOf('--resume') + 1]).toBe(started)
    expect(first!.prompt).toBe('Hi\n(Sent Saturday 2026-09-26T21:00:00+01:00.)')
    expect(second!.prompt).toBe('Again\n(Sent Saturday 2026-09-26T21:00:00+01:00.)')
  })

  it('schedules through the private MCP endpoint and shows the card', async () => {
    process.env['FAKE_MODE'] = 'tool'
    const { session, chat, posts, events, workDir } = setup()
    session.send('Schedule one for Monday 9am')
    await session.idle

    expect(posts.listByDay('2026-09-28').map((p) => p.text)).toEqual(['From the CLI'])
    expect(events.some((e) => e.type === 'tool' && e.name === 'create_posts')).toBe(true)
    expect(chat.list().map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
    if (process.platform !== 'win32') {
      expect(statSync(join(workDir, 'mcp-config.json')).mode & 0o777).toBe(0o600)
    }
  })

  it('says to install Claude Code when it is missing', async () => {
    const { session, events } = setup({ found: false })
    session.send('Hi')
    await session.idle
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'no_cli' })
  })

  it('says to log in when the CLI is logged out', async () => {
    process.env['FAKE_MODE'] = 'login'
    const { session, events } = setup()
    session.send('Hi')
    await session.idle
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'cli_login' })
  })

  it('shows what the CLI printed when it crashes', async () => {
    process.env['FAKE_MODE'] = 'crash'
    const { session, events } = setup()
    session.send('Hi')
    await session.idle
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      code: 'api',
      message: 'Segmentation fault'
    })
  })

  it('kills the CLI on Stop', async () => {
    process.env['FAKE_MODE'] = 'hang'
    const { session, events, chat } = setup()
    session.send('Hi')
    await new Promise((r) => setTimeout(r, 300))
    const started = Date.now()
    session.cancel()
    await session.idle
    expect(Date.now() - started).toBeLessThan(1500)
    expect(events.at(-1)).toMatchObject({ type: 'done', stopped: true })
    expect(chat.list().at(-1)?.content).toBe('Thinking about it')
  })

  it('starts a fresh session from the chat when the CLI lost the old one, or after Clear', async () => {
    const { session, calls } = setup()
    session.send('One')
    await session.idle

    process.env['FAKE_MODE'] = 'nosession'
    session.send('Two')
    await session.idle
    const [, lost, fresh] = calls()
    expect(lost!.args).toContain('--resume')
    expect(fresh!.args).toContain('--session-id')
    expect(fresh!.prompt).toContain('The conversation so far')
    expect(fresh!.prompt).toContain('User: One')
    expect(fresh!.prompt).toContain('You: Hello')

    delete process.env['FAKE_MODE']
    session.clear()
    session.send('Three')
    await session.idle
    const last = calls().at(-1)!
    expect(last.args).toContain('--session-id')
    expect(last.prompt).toBe('Three\n(Sent Saturday 2026-09-26T21:00:00+01:00.)')
  })
})

describe('findClaude', () => {
  const on = (files: string[]) => (p: string) => files.includes(p)

  it('finds it on PATH, then in the usual folders a GUI app misses', () => {
    expect(
      findClaude({
        env: { PATH: '/a:/b' },
        platform: 'darwin',
        home: '/Users/u',
        exists: on(['/b/claude'])
      })
    ).toEqual({ command: '/b/claude', prefix: [] })
    expect(
      findClaude({
        env: { PATH: '/usr/bin' },
        platform: 'darwin',
        home: '/Users/u',
        exists: on(['/Users/u/.local/bin/claude'])
      })?.command
    ).toBe('/Users/u/.local/bin/claude')
    expect(
      findClaude({ env: { PATH: '' }, platform: 'linux', home: '/home/u', exists: on([]) })
    ).toBeNull()
  })

  it("on Windows runs claude.exe, or npm's cli.js on OpenCatt itself instead of the .cmd shim", () => {
    const env = { Path: 'C:\\bin', APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }
    expect(
      findClaude({
        env,
        platform: 'win32',
        home: 'C:\\Users\\u',
        exists: on(['C:\\bin\\claude.exe'])
      })
    ).toEqual({ command: 'C:\\bin\\claude.exe', prefix: [] })
    const npm = 'C:\\Users\\u\\AppData\\Roaming\\npm'
    expect(
      findClaude({
        env,
        platform: 'win32',
        home: 'C:\\Users\\u',
        execPath: 'C:\\OpenCatt\\OpenCatt.exe',
        exists: on([
          `${npm}\\claude.cmd`,
          `${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`
        ])
      })
    ).toEqual({
      command: 'C:\\OpenCatt\\OpenCatt.exe',
      prefix: [`${npm}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`],
      env: { ELECTRON_RUN_AS_NODE: '1' }
    })
  })
})

describe('images', () => {
  it('sends attached images as a stream-json user message, and plain text otherwise', async () => {
    const { session, calls, media } = setup({
      images: (m) => ({ mediaType: 'image/png', data: `data-${m.id}` })
    })
    const id = media.import(fakeMedia(tempDir('opencat-src-'), 'a.png')).id

    session.send('Post this Friday', [id])
    await session.idle
    session.send('Thanks')
    await session.idle

    const [first, second] = calls()
    expect(first.args).toEqual(expect.arrayContaining(['--input-format', 'stream-json']))
    const line = JSON.parse(first.prompt) as {
      type: string
      message: { role: string; content: { type: string; source?: unknown; text?: string }[] }
    }
    expect(line.type).toBe('user')
    expect(line.message.content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: `data-${id}` }
    })
    expect(line.message.content[1].text).toContain(`(Attached: media id ${id} (image)`)
    expect(second.args).not.toContain('--input-format')
    expect(second.prompt).toMatch(/^Thanks\n/)
  })
})

describe('CLI sessions per X account', () => {
  it('keeps one resumable CLI session per account, and names the account in the system prompt', async () => {
    let account: TurnAccount = { id: 'A', handle: 'alpha', name: 'Alpha' }
    const { session, calls, workDir } = setup({ account: () => account })
    const sessionOf = (args: string[]): string =>
      args[args.indexOf(args.includes('--resume') ? '--resume' : '--session-id') + 1]!

    session.send('Hi from A')
    await session.idle
    expect(readFileSync(join(workDir, 'system-prompt.txt'), 'utf8')).toContain(
      'You are writing for the X account Alpha (@alpha).'
    )
    account = { id: 'B', handle: 'beta', name: null }
    session.send('Hi from B')
    await session.idle
    account = { id: 'A', handle: 'alpha', name: 'Alpha' }
    session.send('Back in A')
    await session.idle

    const [a1, b1, a2] = calls()
    expect(b1!.args).toContain('--session-id')
    expect(sessionOf(b1!.args)).not.toBe(sessionOf(a1!.args))
    expect(a2!.args).toContain('--resume')
    expect(sessionOf(a2!.args)).toBe(sessionOf(a1!.args))
    expect(b1!.prompt).not.toContain('Hi from A')
  })
})

describe('CLI writing guide and voice (OP-74)', () => {
  it("writes the user's guide and the account's voice into the system prompt file", async () => {
    const { session, workDir } = setup({
      account: () => ({
        id: 'A',
        handle: 'alpha',
        name: null,
        voice: {
          description: 'lowercase, dry',
          examples: ['gm'],
          language: 'auto',
          emoji: false,
          hashtags: false,
          images: 'always'
        }
      }),
      writing: () => 'Write like a pirate.'
    })
    session.send('Hi')
    await session.idle

    const prompt = readFileSync(join(workDir, 'system-prompt.txt'), 'utf8')
    expect(prompt).toContain("You can't approve posts")
    expect(prompt).toContain('Write like a pirate.')
    expect(prompt).not.toContain('How to write for X')
    expect(prompt).toContain('How its posts sound: lowercase, dry')
    expect(prompt).toContain('<example>\ngm\n</example>')
    expect(prompt).toContain('make one image for every post you write')
  })
})
