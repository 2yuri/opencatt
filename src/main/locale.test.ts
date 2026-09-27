import { describe, expect, it } from 'vitest'
import { weekStartFor } from './locale'

describe('weekStartFor', () => {
  it.each([
    ['en-US', 0],
    ['pt-BR', 0],
    ['fr-FR', 1],
    ['en-GB', 1],
    ['de-DE', 1],
    ['ar-EG', 6]
  ])('starts %s weeks on day %i', (locale, day) => {
    expect(weekStartFor(locale)).toBe(day)
  })

  it('falls back to Monday for a locale it cannot read', () => {
    expect(weekStartFor('')).toBe(1)
    expect(weekStartFor('not a locale!')).toBe(1)
  })
})
