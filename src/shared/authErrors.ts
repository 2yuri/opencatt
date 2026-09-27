/**
 * Why X sign-in failed, and what to tell the user: one copy for onboarding step 4 (OP-42) and
 * the Reconnect X card (OP-27). Texts by Designer.
 */
export type AuthErrorCode = 'callback_mismatch' | 'cancelled' | 'timeout' | 'network'

const MESSAGES: Record<AuthErrorCode, string> = {
  callback_mismatch:
    "X didn't accept the callback. Check your X app's Callback URI is http://127.0.0.1:47823/callback.",
  cancelled: "Sign-in was cancelled. Try again when you're ready.",
  timeout: "X didn't answer in time. Try again.",
  network: "Couldn't reach X. Check your connection and try again."
}

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode | null,
    message: string = code ? MESSAGES[code] : 'X sign-in failed.'
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

// IPC keeps only an error's message, so main writes the code into it and the preload reads it back.
const TAGGED = /\[auth:(\w+)\] ?/

/** The message main throws over IPC, carrying the code. */
export function tagAuthError(err: unknown): Error {
  if (err instanceof AuthError && err.code) return new Error(`[auth:${err.code}] ${err.message}`)
  return err instanceof Error ? err : new Error(String(err))
}

/** In the preload: the IPC rejection as an AuthError with its code again, when it had one. */
export function untagAuthError(err: unknown): unknown {
  const message = err instanceof Error ? err.message : String(err)
  const match = TAGGED.exec(message)
  if (!match || !(match[1]! in MESSAGES)) return err
  return new AuthError(match[1] as AuthErrorCode, message.slice(match.index + match[0].length))
}

export function authErrorMessage(err: unknown): string {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : null
  if (typeof code === 'string' && code in MESSAGES) return MESSAGES[code as AuthErrorCode]
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')
}
