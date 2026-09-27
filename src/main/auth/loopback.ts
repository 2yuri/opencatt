import { createServer, type Server } from 'node:http'
import { X_CALLBACK_PORT } from '@shared/x'
import { AuthError } from '@shared/authErrors'

export const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000

const page = (title: string, text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:15px system-ui;background:#09090b;color:#fafafa;display:grid;place-items:center;height:90vh">` +
  `<div style="text-align:center"><h1 style="font-size:20px">${title}</h1><p>${text}</p></div>`

export interface CallbackOptions {
  state: string
  signal: AbortSignal
  port?: number
  timeoutMs?: number
}

/**
 * Listens on 127.0.0.1 for X's redirect to /callback and resolves its code. Rejects with an
 * AuthError: cancelled when the user denies access or `signal` aborts, timeout after 5 minutes.
 * Resolves once listening via `ready`, so the browser only opens when the port is ours.
 */
export function waitForCallback(options: CallbackOptions): {
  ready: Promise<void>
  code: Promise<string>
  /** Once the port is free again, for the next sign-in to listen on. */
  closed: Promise<void>
} {
  const { state, signal, port = X_CALLBACK_PORT, timeoutMs = CALLBACK_TIMEOUT_MS } = options
  let server: Server | undefined
  let timer: NodeJS.Timeout | undefined
  let settle: { resolve: (code: string) => void; reject: (err: Error) => void }
  const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }))
  // The caller may never await `code` when listening fails; don't let that go unhandled.
  code.catch(() => {})

  const finish = (err: Error | null, value?: string): void => {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    server?.close()
    server?.closeAllConnections()
    if (err) settle.reject(err)
    else settle.resolve(value!)
  }
  const onAbort = (): void => finish(new AuthError('cancelled'))

  let markClosed: () => void
  const closed = new Promise<void>((resolve) => (markClosed = resolve))

  const ready = new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      markClosed()
      return reject(new AuthError('cancelled'))
    }
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const reply = (status: number, title: string, text: string): void => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' })
        res.end(page(title, text))
      }
      // Anything without our state is not the answer to this sign-in: ignore it and keep waiting.
      if (url.searchParams.get('state') !== state) {
        reply(400, 'Sign-in link expired', 'Go back to OpenCatt and start again.')
        return
      }
      const error = url.searchParams.get('error')
      const value = url.searchParams.get('code')
      if (error || !value) {
        reply(200, 'Sign-in cancelled', 'You can close this tab and go back to OpenCatt.')
        finish(
          error && error !== 'access_denied'
            ? new AuthError(null, `X stopped the sign-in: ${error}`)
            : new AuthError('cancelled')
        )
        return
      }
      reply(200, 'Signed in', 'You can close this tab and go back to OpenCatt.')
      finish(null, value)
    })
    server.once('close', () => markClosed())
    server.once('error', (err: NodeJS.ErrnoException) => {
      const busy = err.code === 'EADDRINUSE'
      const failure = new AuthError(
        null,
        busy
          ? `Another program is using port ${port}, which X signs you in through. Close it and try again.`
          : `Couldn't wait for X's answer: ${err.message}`
      )
      finish(failure)
      markClosed()
      reject(failure)
    })
    server.listen(port, '127.0.0.1', () => {
      timer = setTimeout(() => finish(new AuthError('timeout')), timeoutMs)
      resolve()
    })
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return { ready, code, closed }
}
