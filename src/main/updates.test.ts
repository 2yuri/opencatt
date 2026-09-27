import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CHECK_EVERY_MS, isNewer, repoOf, startUpdates, updateMode } from './updates'

describe('repoOf', () => {
  it.each([
    ['github:2yuri/opencatt'],
    ['2yuri/opencatt'],
    ['https://github.com/2yuri/opencatt'],
    ['git+https://github.com/2yuri/opencatt.git'],
    ['git@github.com:2yuri/opencatt.git']
  ])('reads %s', (repository) => {
    expect(repoOf({ repository })).toEqual({ owner: '2yuri', repo: 'opencatt' })
  })

  it('reads the object form, and is null when unset or not GitHub', () => {
    expect(repoOf({ repository: { type: 'git', url: 'https://github.com/a/b.git' } })).toEqual({
      owner: 'a',
      repo: 'b'
    })
    expect(repoOf({})).toBeNull()
    expect(repoOf({ repository: 'https://gitlab.com/a/b' })).toBeNull()
  })

  it('is set in package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { repository?: unknown }
    expect(repoOf(pkg)).toEqual({ owner: '2yuri', repo: 'opencatt' })
  })
})

describe('isNewer', () => {
  it.each([
    ['0.2.0', '0.1.0', true],
    ['v0.1.1', '0.1.0', true],
    ['1.0.0', '0.9.9', true],
    ['0.1.10', '0.1.9', true],
    ['0.1.0', '0.1.0', false],
    ['0.1.0', '0.2.0', false],
    ['0.2.0-beta.1', '0.2.0', false]
  ])('%s over %s is %s', (a, b, newer) => {
    expect(isNewer(a, b)).toBe(newer)
  })
})

describe('updateMode', () => {
  const repo = { owner: 'o', repo: 'r' }
  const base = { packaged: true, appImage: false, repo, hasUpdateConfig: true }

  it('updates Windows and the AppImage by themselves', () => {
    expect(updateMode({ ...base, platform: 'win32' })).toBe('auto')
    expect(updateMode({ ...base, platform: 'linux', appImage: true })).toBe('auto')
  })

  it('only tells macOS and the deb, which cannot update unsigned or outside apt', () => {
    expect(updateMode({ ...base, platform: 'darwin' })).toBe('notice')
    expect(updateMode({ ...base, platform: 'linux' })).toBe('notice')
  })

  it('falls back to the notice without app-update.yml', () => {
    expect(updateMode({ ...base, platform: 'win32', hasUpdateConfig: false })).toBe('notice')
  })

  it('is off in dev and without a repository', () => {
    expect(updateMode({ ...base, platform: 'win32', packaged: false })).toBe('off')
    expect(updateMode({ ...base, platform: 'darwin', repo: null })).toBe('off')
  })
})

describe('startUpdates', () => {
  function app(repository?: string): { appPath: string; resourcesPath: string } {
    const dir = mkdtempSync(join(tmpdir(), 'opencat-updates-'))
    writeFileSync(join(dir, 'package.json'), JSON.stringify(repository ? { repository } : {}))
    return { appPath: dir, resourcesPath: dir }
  }
  const release = (tag: string): Response =>
    new Response(
      JSON.stringify({ tag_name: tag, html_url: `https://github.com/o/r/releases/${tag}` })
    )

  it('tells the user once about a newer release on macOS, and checks again later', async () => {
    const notify = vi.fn()
    let tick: () => void = () => {}
    const setInterval = vi.fn<(run: () => void, ms: number) => unknown>((run) => (tick = run))
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(release('v0.2.0')))
    const mode = startUpdates({
      ...app('github:o/r'),
      packaged: true,
      platform: 'darwin',
      version: '0.1.0',
      appImage: false,
      autoUpdate: vi.fn(),
      notify,
      fetch,
      setInterval
    })
    expect(mode).toBe('notice')
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith('0.2.0', 'https://github.com/o/r/releases/v0.2.0')
    )
    expect(fetch.mock.calls[0]![0]).toBe('https://api.github.com/repos/o/r/releases/latest')
    expect(setInterval.mock.calls[0]![1]).toBe(CHECK_EVERY_MS)

    tick()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('says nothing when the release is not newer or GitHub answers 404 (a private repo)', async () => {
    const notify = vi.fn()
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(release('v0.1.0'))
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }))
    let tick: () => void = () => {}
    startUpdates({
      ...app('github:o/r'),
      packaged: true,
      platform: 'linux',
      version: '0.1.0',
      appImage: false,
      autoUpdate: vi.fn(),
      notify,
      fetch,
      setInterval: (run) => (tick = run)
    })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    tick()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(notify).not.toHaveBeenCalled()
  })

  it('hands Windows to electron-updater and keeps a failed check quiet', async () => {
    const paths = app('github:o/r')
    writeFileSync(join(paths.resourcesPath, 'app-update.yml'), 'provider: github\n')
    const autoUpdate = vi.fn().mockRejectedValue(new Error('404'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mode = startUpdates({
      ...paths,
      packaged: true,
      platform: 'win32',
      version: '0.1.0',
      appImage: false,
      autoUpdate,
      notify: vi.fn(),
      setInterval: vi.fn()
    })
    expect(mode).toBe('auto')
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    expect(autoUpdate).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('does nothing without a repository', () => {
    const fetch = vi.fn()
    expect(
      startUpdates({
        ...app(),
        packaged: true,
        platform: 'darwin',
        version: '0.1.0',
        appImage: false,
        autoUpdate: vi.fn(),
        notify: vi.fn(),
        fetch,
        setInterval: vi.fn()
      })
    ).toBe('off')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('electron-builder.yml', () => {
  const config = readFileSync('electron-builder.yml', 'utf8')

  it('keeps the RunAsNode fuse on: the MCP bridge and the Windows claude launcher need it', () => {
    expect(config).toMatch(/^electronFuses:\n {2}runAsNode: true$/m)
  })

  it('ad-hoc signs macOS and leaves publishing to package.json', () => {
    expect(config).toMatch(/^ {2}identity: '-'$/m)
    expect(config).not.toMatch(/^publish: null/m)
  })
})
