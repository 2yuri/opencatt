import { describe, expect, it } from 'vitest'
import { measureText } from './postText'

describe('measureText', () => {
  it('counts plain text one per character', () => {
    expect(measureText('hello')).toEqual({
      length: 5,
      max: 280,
      remaining: 275,
      over: false,
      empty: false
    })
  })

  it('counts any link as 23, however long', () => {
    const link = 'https://example.com/a/very/long/path/that/goes/on/and/on/for/a/while'
    expect(measureText(link).length).toBe(23)
    expect(measureText(`read ${link}`).length).toBe(28)
  })

  it('counts emoji and CJK characters as 2', () => {
    expect(measureText('👩‍👩‍👧').length).toBe(2)
    expect(measureText('日本語').length).toBe(6)
  })

  it('goes over at 281', () => {
    expect(measureText('a'.repeat(280)).over).toBe(false)
    expect(measureText('a'.repeat(281))).toMatchObject({ over: true, remaining: -1 })
    expect(measureText('日'.repeat(141)).over).toBe(true)
  })

  it('treats whitespace as empty', () => {
    expect(measureText('  \n ').empty).toBe(true)
  })
})
