import type { VoiceImages, VoiceProfile } from '@shared/api'

/** The Language choices, in Settings and the onboarding step; 'auto' follows the request. */
export const LANGUAGES: { value: string; label: string }[] = [
  { value: 'auto', label: 'Same as my request' },
  { value: 'en', label: 'English' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'pt-PT', label: 'Português (Portugal)' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: '日本語' }
]

export const IMAGE_CHOICES: { value: VoiceImages; label: string }[] = [
  { value: 'always', label: 'Always' },
  { value: 'ask', label: 'Ask me' },
  { value: 'never', label: 'Never' }
]

export const MAX_EXAMPLES = 10

const IMAGE_PHRASE: Record<VoiceImages, string> = {
  always: 'designs an image for every post',
  ask: 'asks before making an image',
  never: 'never makes an image'
}

/** One line under the Voice box that says what the agent will do with this profile. */
export function voicePreview(profile: VoiceProfile): string {
  if (profile.description.trim() === '' && profile.examples.length === 0)
    return 'Nothing set yet: the agent will ask you two or three questions before its first post'
  // A code saved elsewhere that isn't in the list still reads sensibly.
  const language =
    profile.language === 'auto'
      ? 'Writes in the language you ask in'
      : `Writes in ${LANGUAGES.find((l) => l.value === profile.language)?.label ?? profile.language}`
  return [
    language,
    profile.emoji ? 'emoji where natural' : 'no emoji',
    profile.hashtags ? 'hashtags' : 'no hashtags',
    IMAGE_PHRASE[profile.images]
  ].join(' · ')
}
