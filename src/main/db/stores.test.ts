import { describe, expect, it } from 'vitest'
import { ChatStore } from './chat'
import { openDatabase } from './database'
import { SettingsStore } from './settings'

describe('SettingsStore', () => {
  it('keeps JSON values and overwrites on set', () => {
    const settings = new SettingsStore(openDatabase(':memory:'))
    expect(settings.get('theme')).toBeNull()
    settings.set('theme', 'dark')
    settings.set('tray', { closeToTray: true, toldUser: false })
    settings.set('theme', 'light')
    expect(settings.get('theme')).toBe('light')
    expect(settings.get('tray')).toEqual({ closeToTray: true, toldUser: false })
  })
})

describe('ChatStore', () => {
  it('keeps the conversation in order and clears it', () => {
    let clock = new Date('2026-09-26T10:00:00Z')
    const chat = new ChatStore(openDatabase(':memory:'), () => clock)
    chat.append({ role: 'user', content: 'Schedule three posts for next week' })
    chat.append({ role: 'assistant', content: 'Done, they are on Monday, Wednesday and Friday.' })
    clock = new Date('2026-09-26T10:01:00Z')
    chat.append({ role: 'user', content: 'Thanks' })

    expect(chat.list().map((m) => [m.role, m.content])).toEqual([
      ['user', 'Schedule three posts for next week'],
      ['assistant', 'Done, they are on Monday, Wednesday and Friday.'],
      ['user', 'Thanks']
    ])
    chat.clear()
    expect(chat.list()).toEqual([])
  })

  it('refuses unknown roles', () => {
    const chat = new ChatStore(openDatabase(':memory:'))
    expect(() => chat.append({ role: 'system' as 'user', content: 'x' })).toThrow(
      /Unknown chat role/
    )
  })
})
