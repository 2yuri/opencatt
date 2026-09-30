import { PLATFORM_RULES, textLength, type PlatformRules } from '@shared/platforms'

/** X's, for screens that are only about X (the voice examples). */
export const MAX_POST_LENGTH = PLATFORM_RULES.x.maxText

export interface TextMeasure {
  /** Length as the platform counts it: on X links are 23, most CJK characters and emoji are 2. */
  length: number
  max: number
  remaining: number
  over: boolean
  empty: boolean
}

export function measureText(text: string, rules: PlatformRules = PLATFORM_RULES.x): TextMeasure {
  const length = textLength(rules, text)
  return {
    length,
    max: rules.maxText,
    remaining: rules.maxText - length,
    over: length > rules.maxText,
    empty: text.trim() === ''
  }
}
