import { MAX_VIDEO_SECONDS } from './render/videoTool'

/** The boss's showreel pre-prompt for Video mode (OP-81), with {duration} filled in. */
export const DEFAULT_VIDEO_PRE_PROMPT =
  "make a dynamic {duration}-second motion graphics video that shows what an incredible motion designer you are, like it's your showreel for a résumé. go all out."
export const DEFAULT_VIDEO_SECONDS = 15
export const MIN_PICKER_SECONDS = 5

/** A length the user wrote, like "a 30-second video" or "20s", within 1 to 60 seconds. */
export function lengthInText(text: string): number | null {
  const match = /\b(\d{1,3})\s*(?:-|\s)?\s*(?:s|secs?|seconds?)\b/i.exec(text)
  if (!match) return null
  const seconds = Number(match[1])
  return seconds >= 1 && seconds <= MAX_VIDEO_SECONDS ? seconds : null
}

/** The picker's value, kept to 5 to 60 seconds. */
export function pickerSeconds(value: unknown): number {
  const n =
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : DEFAULT_VIDEO_SECONDS
  return Math.min(MAX_VIDEO_SECONDS, Math.max(MIN_PICKER_SECONDS, n))
}

/** What goes before the user's text in Video mode: a length in the text wins over the picker. */
export function videoPreface(template: string, text: string, picked: unknown): string {
  const seconds = lengthInText(text) ?? pickerSeconds(picked)
  return template.replaceAll('{duration}', String(seconds))
}
