import { describe, expect, it } from 'vitest'
import { oauth1Header } from './oauth1'

describe('oauth1Header', () => {
  // X's own worked example, "Creating a signature" in its OAuth 1.0a docs.
  it('matches the signature from X’s documentation', () => {
    const header = oauth1Header(
      {
        apiKey: 'xvz1evFS4wEEPTGEFPHBog',
        apiKeySecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
        accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
        accessTokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE'
      },
      {
        method: 'post',
        url: 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true',
        form: { status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
        nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
        timestamp: 1318622958
      }
    )
    expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"')
    expect(header).toMatch(/^OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog", oauth_nonce=/)
    expect(header).not.toContain('status=')
  })
})
