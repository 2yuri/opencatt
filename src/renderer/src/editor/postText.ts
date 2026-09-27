// The package's ESM build has only a default export, whatever its types say.
import twitterText from 'twitter-text'

export const MAX_POST_LENGTH = 280

export interface TextMeasure {
  /** Length as X counts it: links are 23, most CJK characters and emoji are 2. */
  length: number
  remaining: number
  over: boolean
  empty: boolean
}

export function measureText(text: string): TextMeasure {
  const { weightedLength } = twitterText.parseTweet(text)
  return {
    length: weightedLength,
    remaining: MAX_POST_LENGTH - weightedLength,
    over: weightedLength > MAX_POST_LENGTH,
    empty: text.trim() === ''
  }
}
