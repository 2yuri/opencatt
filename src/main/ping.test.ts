import { describe, expect, it } from 'vitest'
import { ping } from './ping'

describe('ping', () => {
  it('answers pong with the runtime it was given', () => {
    expect(ping('44.0.0', 'darwin')).toEqual({
      message: 'pong',
      electron: '44.0.0',
      platform: 'darwin'
    })
  })
})
