import { describe, expect, it, vi } from 'vitest'
import type { ClaudeCliStatus } from '@shared/api'
import { SettingsStore } from '../db'
import { openDatabase } from '../db/database'
import { AgentConfig, type SecretStore } from './config'
import { AgentError } from './session'
import { AgentSettings } from './settings'

const CLI_OK: ClaudeCliStatus = {
  found: true,
  path: '/home/me/.local/bin/claude',
  version: '2.1.283',
  loggedIn: true,
  plan: 'max',
  error: null
}

function setup(available = true, cli: ClaudeCliStatus | null = null) {
  const values = new Map<string, unknown>()
  const secrets: SecretStore = {
    isAvailable: () => available,
    get: <T>(name: string) => (values.get(name) as T) ?? null,
    set: (name, value) => {
      if (!available) throw new Error('no keyring')
      values.set(name, value)
    },
    delete: (name) => void values.delete(name)
  }
  const config = new AgentConfig(secrets, new SettingsStore(openDatabase(':memory:')))
  const check = vi.fn(async (key: string) => {
    if (key !== 'sk-good') throw new AgentError('bad_key', 'Anthropic refused the API key.')
  })
  const detect = vi.fn(async () => cli ?? { ...CLI_OK, found: false, path: null, loggedIn: false })
  const claude = { found: () => cli?.found === true, detect }
  return { settings: new AgentSettings(config, check, claude), config, check, values, detect }
}

describe('AgentSettings', () => {
  it('saves a key only after the provider accepts it', async () => {
    const { settings, config, values } = setup()
    await expect(settings.setKey('sk-bad')).rejects.toThrow('refused')
    expect(values.size).toBe(0)

    const status = await settings.setKey('  sk-good ')
    expect(status).toMatchObject({ hasKey: true, canStoreKey: true, model: 'claude-opus-5-5' })
    expect(config.key()).toBe('sk-good')
    expect(JSON.stringify(status)).not.toContain('sk-good')

    expect((await settings.clearKey()).hasKey).toBe(false)
  })

  it('refuses before checking when there is no keyring', async () => {
    const { settings, check } = setup(false)
    await expect(settings.setKey('sk-good')).rejects.toThrow('keyring')
    expect(check).not.toHaveBeenCalled()
    expect(await settings.status()).toMatchObject({ hasKey: false, canStoreKey: false })
  })

  it('takes any model id, including one typed in, and refuses what is not an id', async () => {
    const { settings } = setup()
    expect((await settings.setModel('claude-sonnet-5')).model).toBe('claude-sonnet-5')
    const typed = await settings.setModel(' claude-opus-6 ')
    expect(typed.model).toBe('claude-opus-6')
    expect(typed.models.at(-1)).toEqual({ id: 'claude-opus-6', label: 'claude-opus-6 (typed in)' })
    await expect(settings.setModel('opus; rm -rf')).rejects.toThrow("isn't a model id")
  })

  it('defaults to the CLI when it is installed, the API key otherwise', async () => {
    expect(setup(true, CLI_OK).settings.provider()).toBe('cli')
    const { settings } = setup()
    expect(settings.provider()).toBe('api')
    expect(await settings.status()).toMatchObject({
      provider: 'api',
      providerChosen: false,
      cli: { found: false },
      ready: false
    })
  })

  it('keeps the provider the user picked, even when the CLI is installed', async () => {
    const { settings } = setup(true, CLI_OK)
    expect(await settings.setProvider('api')).toMatchObject({
      provider: 'api',
      providerChosen: true,
      ready: false
    })
    expect(settings.provider()).toBe('api')
    await expect(settings.setProvider('gpt' as 'api')).rejects.toThrow('Unknown provider')
  })

  it('is ready on the CLI only once it is logged in', async () => {
    expect(await setup(true, CLI_OK).settings.status()).toMatchObject({ ready: true })
    const out = setup(true, { ...CLI_OK, loggedIn: false, plan: null })
    expect(await out.settings.status()).toMatchObject({ provider: 'cli', ready: false })
  })

  it('checks the CLI once, and again on recheck', async () => {
    const { settings, detect } = setup(true, CLI_OK)
    await settings.status()
    await settings.status()
    expect(detect).toHaveBeenCalledTimes(1)
    await settings.recheck()
    expect(detect).toHaveBeenCalledTimes(2)
  })

  it('names who answers, for the label under each reply', async () => {
    const { settings } = setup(true, CLI_OK)
    expect(settings.via()).toBe('Claude Code · Opus 5.5')
    await settings.setProvider('api')
    await settings.setModel('claude-sonnet-5')
    expect(settings.via()).toBe('API key · Sonnet 5')
  })
})

describe('model list and default (OP-93)', () => {
  const listed = [
    { id: 'claude-opus-6', displayName: 'Claude Opus 6', adaptiveThinking: true },
    { id: 'claude-opus-5-5', displayName: 'Claude Opus 5.5', adaptiveThinking: true },
    { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', adaptiveThinking: false }
  ]

  function withList(list: () => Promise<typeof listed>, now = { t: 1_000 }) {
    const values = new Map<string, unknown>([['anthropic.apiKey', 'sk-good']])
    const secrets: SecretStore = {
      isAvailable: () => true,
      get: <T>(name: string) => (values.get(name) as T) ?? null,
      set: (name, value) => void values.set(name, value),
      delete: (name) => void values.delete(name)
    }
    const config = new AgentConfig(secrets, new SettingsStore(openDatabase(':memory:')))
    config.setProvider('api')
    const fetch = vi.fn(list)
    const settings = new AgentSettings(
      config,
      async () => {},
      undefined,
      fetch,
      () => now.t
    )
    return { settings, config, fetch, now }
  }

  it("lists the key's models from the API, known ones first, and fetches again after a day", async () => {
    const { settings, config, fetch, now } = withList(async () => listed)
    const first = await settings.status()
    expect(first.models.map((m) => m.id)).toEqual([
      'claude-opus-5-5',
      'claude-haiku-4-5',
      'claude-opus-6'
    ])
    expect(first.models[0]!.label).toBe('Claude Opus 5.5, best for most posts')
    // A model the table doesn't know takes adaptive thinking from what the API said.
    expect(config.shape('claude-opus-6')).toEqual({ adaptiveThinking: true, fallbacks: false })

    await settings.status()
    expect(fetch).toHaveBeenCalledTimes(1)
    now.t += 24 * 60 * 60 * 1000 + 1
    await settings.status()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('falls back to the built-in list when the API fails, and on the CLI path', async () => {
    const offline = withList(async () => {
      throw new Error('Could not reach Anthropic.')
    })
    expect((await offline.settings.status()).models.map((m) => m.id)).toEqual([
      'claude-opus-5-5',
      'claude-fable-5-1',
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-haiku-4-5'
    ])
    const cli = withList(async () => listed)
    cli.config.setProvider('cli')
    expect((await cli.settings.status()).models).toHaveLength(5)
    expect(cli.fetch).not.toHaveBeenCalled()
  })

  it('keeps Opus 5 for installs from before the new default, and gives new ones Opus 5.5', () => {
    const fresh = setup()
    fresh.config.keepPreviousDefault()
    expect(fresh.config.model()).toBe('claude-opus-5-5')

    const existing = setup()
    existing.config.setProvider('cli')
    existing.config.keepPreviousDefault()
    expect(existing.config.model()).toBe('claude-opus-5')

    const picked = setup()
    picked.config.setProvider('api')
    picked.config.setModel('claude-sonnet-5')
    picked.config.keepPreviousDefault()
    expect(picked.config.model()).toBe('claude-sonnet-5')
  })
})
