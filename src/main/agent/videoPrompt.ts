import type { VideoPrePrompt } from '@shared/api'
import type { SettingsStore } from '../db'
import { DEFAULT_VIDEO_PRE_PROMPT } from './videoPreface'

const KEY = 'video.prePrompt'

/** Video mode's pre-prompt (OP-81): the boss's default, or the user's edit from Settings. */
export class VideoPrePromptStore {
  constructor(private readonly settings: SettingsStore) {}

  get(): VideoPrePrompt {
    const saved = this.settings.get(KEY)
    return typeof saved === 'string' && saved.trim()
      ? { text: saved, isDefault: saved === DEFAULT_VIDEO_PRE_PROMPT }
      : { text: DEFAULT_VIDEO_PRE_PROMPT, isDefault: true }
  }

  set(text: string): VideoPrePrompt {
    const value = typeof text === 'string' ? text.trim() : ''
    if (!value) throw new Error('Write the pre-prompt, or reset it to the default.')
    if (value.length > 4000) throw new Error('Keep the pre-prompt under 4,000 characters.')
    this.settings.set(KEY, value)
    return this.get()
  }

  reset(): VideoPrePrompt {
    this.settings.set(KEY, DEFAULT_VIDEO_PRE_PROMPT)
    return this.get()
  }
}
