import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { X_CALLBACK_URL } from '@shared/x'
import { waitForCallback } from './loopback'
import { pkceRequest } from './pkce'
import { freePort } from './testPort'

const hit = (port: number, query: string): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/callback?${query}`)

describe('pkceRequest', () => {
  it('asks X for our scopes with an S256 challenge of the verifier', () => {
    const request = pkceRequest('client-id-1234567890abc')
    const url = new URL(request.url)
    expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize')
    expect(url.searchParams.get('redirect_uri')).toBe(X_CALLBACK_URL)
    expect(url.searchParams.get('client_id')).toBe('client-id-1234567890abc')
    expect(url.searchParams.get('scope')).toBe(
      'tweet.read tweet.write users.read media.write offline.access'
    )
    expect(url.searchParams.get('state')).toBe(request.state)
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(request.verifier).digest('base64url')
    )
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('waitForCallback', () => {
  it('resolves the code of the redirect that carries our state, ignoring others', async () => {
    const port = await freePort()
    const wait = waitForCallback({ state: 's1', signal: new AbortController().signal, port })
    await wait.ready
    expect((await hit(port, 'state=other&code=nope')).status).toBe(400)
    const res = await hit(port, 'state=s1&code=abc')
    expect(await res.text()).toContain('Signed in')
    await expect(wait.code).resolves.toBe('abc')
    await wait.closed
  })

  it('is cancelled when the user denies access', async () => {
    const port = await freePort()
    const wait = waitForCallback({ state: 's1', signal: new AbortController().signal, port })
    await wait.ready
    await hit(port, 'state=s1&error=access_denied')
    await expect(wait.code).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('is cancelled when aborted, and frees the port', async () => {
    const port = await freePort()
    const controller = new AbortController()
    const wait = waitForCallback({ state: 's1', signal: controller.signal, port })
    await wait.ready
    controller.abort()
    await expect(wait.code).rejects.toMatchObject({ code: 'cancelled' })
    await wait.closed
    const again = waitForCallback({ state: 's2', signal: new AbortController().signal, port })
    await again.ready
    await hit(port, 'state=s2&code=ok')
    await expect(again.code).resolves.toBe('ok')
  })

  it('times out', async () => {
    const port = await freePort()
    const wait = waitForCallback({
      state: 's1',
      signal: new AbortController().signal,
      port,
      timeoutMs: 20
    })
    await wait.ready
    await expect(wait.code).rejects.toMatchObject({ code: 'timeout' })
  })

  it('says so when another program holds the port', async () => {
    const port = await freePort()
    const first = waitForCallback({ state: 'a', signal: new AbortController().signal, port })
    await first.ready
    const second = waitForCallback({ state: 'b', signal: new AbortController().signal, port })
    await expect(second.ready).rejects.toThrow(`Another program is using port ${port}`)
    await hit(port, 'state=a&code=x')
    await first.code
  })
})
