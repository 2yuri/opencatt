import { describe, expect, it } from 'vitest'
import { SettingsStore } from '../db'
import { openDatabase } from '../db/database'
import { DEFAULT_VIDEO_PRE_PROMPT, lengthInText, videoPreface } from './videoPreface'
import { VideoPrePromptStore } from './videoPrompt'

describe('videoPreface', () => {
  it('fills the boss pre-prompt with the picker length', () => {
    expect(videoPreface(DEFAULT_VIDEO_PRE_PROMPT, 'our launch', 15)).toBe(
      "make a dynamic 15-second motion graphics video that shows what an incredible motion designer you are, like it's your showreel for a résumé. go all out."
    )
  })

  it('lets a length in the text win over the picker, and keeps the picker to 5 to 60', () => {
    expect(videoPreface('{duration}s', 'a 30-second teaser', 15)).toBe('30s')
    expect(videoPreface('{duration}s', 'make it 8s long', 15)).toBe('8s')
    expect(videoPreface('{duration}s', 'our launch', 2)).toBe('5s')
    expect(videoPreface('{duration}s', 'our launch', 90)).toBe('60s')
    expect(videoPreface('{duration}s', 'our launch', undefined)).toBe('15s')
  })

  it('ignores lengths video cannot be', () => {
    expect(lengthInText('a 90-second video')).toBeNull()
    expect(lengthInText('a 45 sec clip')).toBe(45)
    expect(lengthInText('schedule 3 posts')).toBeNull()
  })
})

describe('VideoPrePromptStore', () => {
  it('starts on the default, saves an edit, and resets', () => {
    const store = new VideoPrePromptStore(new SettingsStore(openDatabase(':memory:')))
    expect(store.get()).toEqual({ text: DEFAULT_VIDEO_PRE_PROMPT, isDefault: true })
    expect(store.set('  calm {duration}-second loop  ')).toEqual({
      text: 'calm {duration}-second loop',
      isDefault: false
    })
    expect(() => store.set('   ')).toThrow(/Write the pre-prompt/)
    expect(store.reset().isDefault).toBe(true)
  })
})
