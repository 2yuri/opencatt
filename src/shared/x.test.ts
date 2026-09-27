import { describe, expect, it } from 'vitest'
import { clientIdError, oauth1KeysErrors, trimKeys, X_CALLBACK_URL } from './x'

describe('X_CALLBACK_URL', () => {
  it('is the exact loopback URL users register with X', () => {
    expect(X_CALLBACK_URL).toBe('http://127.0.0.1:47823/callback')
  })
})

describe('clientIdError', () => {
  it('accepts a Client ID as X shows it', () => {
    expect(clientIdError('dGhpc2lzYW5leGFtcGxlOjE6Y2k')).toBeNull()
    expect(clientIdError('abc_DEF-123456789012345')).toBeNull()
  })

  it.each([
    ['', /Paste the Client ID from your app's Keys & Tokens tab/],
    ['abc def ghi jkl mno pqr stu', /no spaces/],
    ['short123', /too short/],
    ['this!is!not!a!client!id!at!all', /does not look like/],
    ['x'.repeat(65), /does not look like/]
  ])('rejects %j', (value, message) => {
    expect(clientIdError(value)).toMatch(message)
  })
})

describe('oauth1KeysErrors', () => {
  const good = {
    apiKey: 'xvz1evFS4wEEPTGEFPHBog',
    apiKeySecret: 'L8qq9PZyRg6ieKGEKhZolGC0vJWLw8iEJ88DRdyOg',
    accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
    accessTokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE'
  }

  it('accepts keys shaped like the ones X generates', () => {
    expect(oauth1KeysErrors(good)).toEqual({})
  })

  it('names each empty field', () => {
    const errors = oauth1KeysErrors({
      apiKey: '',
      apiKeySecret: '',
      accessToken: '',
      accessTokenSecret: ''
    })
    expect(Object.keys(errors).sort()).toEqual([
      'accessToken',
      'accessTokenSecret',
      'apiKey',
      'apiKeySecret'
    ])
    expect(errors.apiKey).toBe('Paste the Consumer Key.')
  })

  it('catches a Bearer Token pasted as the Access Token', () => {
    const errors = oauth1KeysErrors({
      ...good,
      accessToken: 'AAAAAAAAAAAAAAAAAAAAAMLheAAAAAAA0%2BuSeid%2BULvsea4JtiGRiSDSJSI'
    })
    expect(errors.accessToken).toMatch(/Bearer Token/)
  })

  it('trims pasted whitespace', () => {
    expect(trimKeys({ ...good, apiKey: `  ${good.apiKey}\n` }).apiKey).toBe(good.apiKey)
  })
})
