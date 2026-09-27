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
    expect(status).toMatchObject({ hasKey: true, canStoreKey: true, model: 'claude-opus-5' })
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

  it('keeps the model to the known list', async () => {
    const { settings } = setup()
    expect((await settings.setModel('claude-sonnet-5')).model).toBe('claude-sonnet-5')
    await expect(settings.setModel('gpt-5')).rejects.toThrow('Unknown model')
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
    expect(settings.via()).toBe('Claude Code · Opus 5')
    await settings.setProvider('api')
    await settings.setModel('claude-sonnet-5')
    expect(settings.via()).toBe('API key · Sonnet 5')
  })
})
