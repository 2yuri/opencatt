import { describe, expect, it } from 'vitest'
import type { VoiceProfile } from '@shared/api'
import { SettingsStore } from '../db'
import { openDatabase } from '../db/database'
import { DEFAULT_WRITING, accountNote, basePrompt, voiceNote } from './prompt'
import { DEFAULT_VOICE, VoiceStore, WritingPromptStore } from './voice'

function setup() {
  const settings = new SettingsStore(openDatabase(':memory:'))
  const changes: [string, VoiceProfile][] = []
  const voices = new VoiceStore(
    settings,
    (id) => id === 'A' || id === 'B',
    (id, profile) => changes.push([id, profile])
  )
  return { settings, voices, changes }
}

describe('VoiceStore', () => {
  it('gives the defaults for an account with nothing saved', () => {
    expect(setup().voices.get('A')).toEqual({
      description: '',
      examples: [],
      language: 'auto',
      emoji: false,
      hashtags: false,
      images: 'ask'
    })
  })

  it('saves a patch over what is there, per account, and reports each save', () => {
    const { voices, changes } = setup()
    voices.set('A', { description: '  lowercase, dry  ', language: 'pt-br' })
    const saved = voices.set('A', { emoji: true, examples: [' one ', '', 'two'] })

    expect(saved).toEqual({
      ...DEFAULT_VOICE,
      description: 'lowercase, dry',
      language: 'pt-BR',
      emoji: true,
      examples: ['one', 'two']
    })
    expect(voices.get('A')).toEqual(saved)
    expect(voices.get('B')).toEqual(DEFAULT_VOICE)
    expect(changes.map(([id]) => id)).toEqual(['A', 'A'])
    expect(changes[1]![1]).toEqual(saved)
  })

  it('refuses the whole patch when any field is wrong, and saves nothing', () => {
    const { voices, changes } = setup()
    expect(() => voices.set('C', { emoji: true })).toThrow("That X account isn't connected.")
    expect(() =>
      voices.set('A', { emoji: true, examples: Array.from({ length: 11 }, (_, i) => `p${i}`) })
    ).toThrow('Keep it to 10 example posts.')
    // 141 emoji count as 282 on X, though they are 141 characters long.
    expect(() => voices.set('A', { examples: ['fine', '😀'.repeat(141)] })).toThrow(
      'Example 2 is over 280 characters as X counts them.'
    )
    expect(() => voices.set('A', { language: 'not a language!' })).toThrow("isn't a language code")
    expect(() => voices.set('A', { images: 'sometimes' as never })).toThrow(
      'Images must be always, ask or never.'
    )
    expect(voices.get('A')).toEqual(DEFAULT_VOICE)
    expect(changes).toEqual([])
  })

  it('reads a damaged saved voice field by field', () => {
    const { settings, voices } = setup()
    settings.set('voice.A', {
      description: 'kept',
      examples: ['ok', 3],
      images: 'loud',
      emoji: 'y'
    })
    expect(voices.get('A')).toEqual({ ...DEFAULT_VOICE, description: 'kept', examples: ['ok'] })
  })
})

describe('WritingPromptStore', () => {
  it('uses the built-in guide until the user saves their own, and goes back on reset', () => {
    const writing = new WritingPromptStore(new SettingsStore(openDatabase(':memory:')))
    expect(writing.get()).toEqual({ text: DEFAULT_WRITING, isDefault: true })
    expect(writing.set('  Write like a pirate.  ')).toEqual({
      text: 'Write like a pirate.',
      isDefault: false
    })
    expect(() => writing.set('   ')).toThrow('Write the prompt, or reset it to the default.')
    expect(writing.reset()).toEqual({ text: DEFAULT_WRITING, isDefault: true })
  })
})

describe('voice in the prompt', () => {
  const voice = (patch: Partial<VoiceProfile> = {}): VoiceProfile => ({
    ...DEFAULT_VOICE,
    ...patch
  })

  it('keeps the app rules whatever writing guide is in use', () => {
    const base = basePrompt('Write like a pirate.')
    expect(base).toContain("Every post you create or change waits for the user's approval")
    expect(base.endsWith('Write like a pirate.')).toBe(true)
    expect(basePrompt(DEFAULT_WRITING)).toContain('280 characters as X counts them')
  })

  it('writes the saved voice under the account, examples fenced, language by name', () => {
    const note = accountNote({
      handle: 'alpha',
      name: 'Alpha',
      voice: voice({
        description: 'lowercase, dry',
        language: 'pt-BR',
        hashtags: true,
        examples: ['first post', 'second post']
      })
    })
    expect(note).toContain('You are writing for the X account Alpha (@alpha).')
    expect(note).toContain('How its posts sound: lowercase, dry')
    expect(note).toContain('write posts in Brazilian Portuguese')
    expect(note).toContain('Emoji: none.')
    expect(note).toContain('Hashtags: part of this voice.')
    expect(note).toContain('<example>\nsecond post\n</example>')
    expect(note).not.toContain('ask two or three short questions')
    expect(note).toContain('follow the message for that request')
  })

  it('asks a few questions first only when no description or examples are saved', () => {
    expect(voiceNote('a', voice())).toContain('ask two or three short questions')
    expect(voiceNote('a', voice({ description: 'calm' }))).not.toContain('questions')
    expect(voiceNote('a', voice({ examples: ['hi'] }))).not.toContain('questions')
  })

  it('turns the image preference into a rule for render_image', () => {
    expect(voiceNote('a', voice({ images: 'always' }))).toContain(
      'make one image for every post you write'
    )
    expect(voiceNote('a', voice({ images: 'ask' }))).toContain('ask whether they want one')
    expect(voiceNote('a', voice({ images: 'never' }))).toContain("don't make images")
  })

  it('leaves the voice out when the account has none loaded', () => {
    expect(accountNote({ handle: 'alpha', name: null })).toBe(
      "You are writing for the X account @alpha. Every post you create, list or move is that account's; write in its voice."
    )
  })
})
