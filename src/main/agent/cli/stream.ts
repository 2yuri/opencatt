/** The parts of the claude CLI's --output-format stream-json that the chat needs. */

export type CliEvent =
  | { kind: 'session'; id: string }
  | { kind: 'text'; delta: string }
  | { kind: 'tool'; name: string }
  /** The CLI flagged an API error, e.g. authentication_failed, rate_limit, model_not_found. */
  | { kind: 'api_error'; code: string }
  | { kind: 'result'; isError: boolean; text: string; status: number | null }

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {})

/** One line of stream-json, or nothing for lines the chat doesn't care about. */
export function parseCliLine(line: string, toolPrefix: string): CliEvent | null {
  let e: Json
  try {
    e = obj(JSON.parse(line))
  } catch {
    return null
  }
  switch (e['type']) {
    case 'system':
      return e['subtype'] === 'init' && typeof e['session_id'] === 'string'
        ? { kind: 'session', id: e['session_id'] }
        : null
    case 'stream_event': {
      const event = obj(e['event'])
      if (event['type'] === 'content_block_delta') {
        const delta = obj(event['delta'])
        return delta['type'] === 'text_delta' && typeof delta['text'] === 'string' && delta['text']
          ? { kind: 'text', delta: delta['text'] }
          : null
      }
      if (event['type'] === 'content_block_start') {
        const block = obj(event['content_block'])
        if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
          const name = block['name'].startsWith(toolPrefix)
            ? block['name'].slice(toolPrefix.length)
            : block['name']
          return { kind: 'tool', name }
        }
      }
      return null
    }
    case 'assistant':
      return typeof e['error'] === 'string' ? { kind: 'api_error', code: e['error'] } : null
    case 'result':
      return {
        kind: 'result',
        isError: e['is_error'] === true,
        text: typeof e['result'] === 'string' ? e['result'] : '',
        status: typeof e['api_error_status'] === 'number' ? e['api_error_status'] : null
      }
    default:
      return null
  }
}
