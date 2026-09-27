import twitter from 'twitter-text'
import type { JsonValue, VoiceImages, VoiceProfile, WritingPrompt } from '@shared/api'
import type { SettingsStore } from '../db'
import { DEFAULT_WRITING } from './prompt'

export const MAX_EXAMPLES = 10
const MAX_DESCRIPTION = 2000
const MAX_WRITING = 20000
const IMAGES: readonly VoiceImages[] = ['always', 'ask', 'never']

export const DEFAULT_VOICE: VoiceProfile = {
  description: '',
  examples: [],
  language: 'auto',
  emoji: false,
  hashtags: false,
  images: 'ask'
}

const key = (accountId: string): string => `voice.${accountId}`

/** 'auto', or the canonical form of a language code; null when it isn't one. */
function languageOf(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === 'auto') return 'auto'
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? null
  } catch {
    return null
  }
}

/**
 * Each X account's voice (OP-74), in settings under voice.<account id>. Only the user writes it,
 * through Settings; the agent reads it when a turn starts.
 */
export class VoiceStore {
  constructor(
    private readonly settings: SettingsStore,
    /** Whether an X account with this id is connected. */
    private readonly known: (accountId: string) => boolean,
    private readonly onChanged: (accountId: string, profile: VoiceProfile) => void = () => {}
  ) {}

  get(accountId: string): VoiceProfile {
    const saved = this.settings.get(key(accountId))
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { ...DEFAULT_VOICE }
    // Read field by field, so a profile saved by an older version still loads.
    const s = saved as Record<string, JsonValue>
    return {
      description: typeof s.description === 'string' ? s.description : DEFAULT_VOICE.description,
      examples: Array.isArray(s.examples)
        ? s.examples.filter((e): e is string => typeof e === 'string')
        : [],
      language:
        typeof s.language === 'string'
          ? (languageOf(s.language) ?? 'auto')
          : DEFAULT_VOICE.language,
      emoji: typeof s.emoji === 'boolean' ? s.emoji : DEFAULT_VOICE.emoji,
      hashtags: typeof s.hashtags === 'boolean' ? s.hashtags : DEFAULT_VOICE.hashtags,
      images: IMAGES.includes(s.images as VoiceImages)
        ? (s.images as VoiceImages)
        : DEFAULT_VOICE.images
    }
  }

  /** Saves the fields in the patch over what's saved; anything invalid refuses the whole patch. */
  set(accountId: string, patch: Partial<VoiceProfile>): VoiceProfile {
    if (!this.known(accountId)) throw new Error("That X account isn't connected.")
    if (!patch || typeof patch !== 'object') throw new Error('Nothing to save.')
    const next = { ...this.get(accountId) }

    if (patch.description !== undefined) {
      if (typeof patch.description !== 'string') throw new Error('The description must be text.')
      const description = patch.description.trim()
      if (description.length > MAX_DESCRIPTION) {
        throw new Error(
          `Keep the description under ${MAX_DESCRIPTION.toLocaleString('en')} characters.`
        )
      }
      next.description = description
    }
    if (patch.examples !== undefined) {
      if (!Array.isArray(patch.examples)) throw new Error('The example posts must be a list.')
      const examples = patch.examples
        .map((e) => (typeof e === 'string' ? e.trim() : ''))
        .filter(Boolean)
      if (examples.length > MAX_EXAMPLES) {
        throw new Error(`Keep it to ${MAX_EXAMPLES} example posts.`)
      }
      const long = examples.findIndex((e) => twitter.parseTweet(e).weightedLength > 280)
      if (long >= 0) {
        throw new Error(`Example ${long + 1} is over 280 characters as X counts them.`)
      }
      next.examples = examples
    }
    if (patch.language !== undefined) {
      const language = typeof patch.language === 'string' ? languageOf(patch.language) : null
      if (!language) throw new Error("That isn't a language code, like en or pt-BR.")
      next.language = language
    }
    if (patch.emoji !== undefined) {
      if (typeof patch.emoji !== 'boolean') throw new Error('Emoji must be on or off.')
      next.emoji = patch.emoji
    }
    if (patch.hashtags !== undefined) {
      if (typeof patch.hashtags !== 'boolean') throw new Error('Hashtags must be on or off.')
      next.hashtags = patch.hashtags
    }
    if (patch.images !== undefined) {
      if (!IMAGES.includes(patch.images)) throw new Error('Images must be always, ask or never.')
      next.images = patch.images
    }

    this.settings.set(key(accountId), { ...next })
    this.onChanged(accountId, next)
    return next
  }
}

/** The base writing guide (OP-74): the built-in one, or the user's own from Settings. */
export class WritingPromptStore {
  static readonly KEY = 'agent.writingPrompt'

  constructor(private readonly settings: SettingsStore) {}

  get(): WritingPrompt {
    const saved = this.settings.get(WritingPromptStore.KEY)
    return typeof saved === 'string' && saved.trim() && saved !== DEFAULT_WRITING
      ? { text: saved, isDefault: false }
      : { text: DEFAULT_WRITING, isDefault: true }
  }

  set(text: string): WritingPrompt {
    const value = typeof text === 'string' ? text.trim() : ''
    if (!value) throw new Error('Write the prompt, or reset it to the default.')
    if (value.length > MAX_WRITING) {
      throw new Error(`Keep the prompt under ${MAX_WRITING.toLocaleString('en')} characters.`)
    }
    this.settings.set(WritingPromptStore.KEY, value)
    return this.get()
  }

  /** Clears the user's text, so a later change to the built-in guide reaches them. */
  reset(): WritingPrompt {
    this.settings.set(WritingPromptStore.KEY, null)
    return this.get()
  }
}
