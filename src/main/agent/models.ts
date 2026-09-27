import type { AgentModel } from '@shared/api'

/** What a request to a model sends beyond the basics (OP-93). */
export interface ModelShape {
  /** thinking: { type: 'adaptive' }. Off where thinking is always on or not adaptive. */
  adaptiveThinking: boolean
  /** fallbacks: 'default', so a declined request is re-run on another model server-side. */
  fallbacks: boolean
}

export interface KnownModel extends AgentModel, ModelShape {}

/**
 * The models OpenCatt knows, best first, from Anthropic's model reference. Adding a model is one
 * row. Fable 5.1 thinks on every request and takes no thinking field; fallbacks: 'default' is
 * documented for Opus 5 only.
 */
export const KNOWN_MODELS: KnownModel[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5, best for most posts',
    adaptiveThinking: true,
    fallbacks: false
  },
  {
    id: 'claude-fable-5-1',
    label: 'Claude Fable 5.1, most capable, costs the most',
    adaptiveThinking: false,
    fallbacks: false
  },
  {
    id: 'claude-opus-5',
    label: 'Claude Opus 5, the previous Opus',
    adaptiveThinking: true,
    fallbacks: true
  },
  {
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5, cheaper',
    adaptiveThinking: true,
    fallbacks: false
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5, cheapest',
    adaptiveThinking: false,
    fallbacks: false
  }
]

/** New installs start here. */
export const DEFAULT_MODEL = 'claude-opus-5-5'
/** Where installs from before OP-93 were, whether they picked it or not; they keep it. */
export const PREVIOUS_DEFAULT = 'claude-opus-5'

/** A model the API listed for the user's key, with what its capabilities say. */
export interface ListedModel {
  id: string
  displayName: string
  /** From capabilities.thinking.types.adaptive; null when the API didn't say. */
  adaptiveThinking: boolean | null
}

/** Model ids as Anthropic writes them; anything else never reaches the CLI or the API. */
const MODEL_ID = /^[a-z0-9][a-z0-9._:@-]{1,99}$/i

export function isModelId(value: unknown): value is string {
  return typeof value === 'string' && MODEL_ID.test(value)
}

/** How to call a model: the table's row, else what the API listed, else nothing extra. */
export function shapeOf(id: string, listed: readonly ListedModel[] = []): ModelShape {
  const known = KNOWN_MODELS.find((m) => m.id === id)
  if (known) return { adaptiveThinking: known.adaptiveThinking, fallbacks: known.fallbacks }
  const found = listed.find((m) => m.id === id)
  return { adaptiveThinking: found?.adaptiveThinking === true, fallbacks: false }
}

/**
 * The picker's list: the known models the key can use, in the table's order with its labels,
 * then the others the API lists for it. Without a list (the CLI, or offline) it is the table.
 */
export function pickerModels(listed: readonly ListedModel[] | null): AgentModel[] {
  const known = (m: KnownModel): AgentModel => ({ id: m.id, label: m.label })
  if (!listed || listed.length === 0) return KNOWN_MODELS.map(known)
  const ids = new Set(listed.map((m) => m.id))
  return [
    ...KNOWN_MODELS.filter((m) => ids.has(m.id)).map(known),
    ...listed
      .filter((m) => !KNOWN_MODELS.some((k) => k.id === m.id))
      .map((m) => ({ id: m.id, label: m.displayName }))
  ]
}
