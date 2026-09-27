import { describe, expect, it } from 'vitest'
import { defaultFields, fromFields, toFields } from './schedule'

const now = new Date(2026, 8, 26, 10, 20)

describe('defaultFields', () => {
  it('starts today at the next full hour', () => {
    expect(defaultFields(undefined, now)).toEqual({ date: '2026-09-26', time: '11:00' })
    expect(defaultFields('2026-09-26', now)).toEqual({ date: '2026-09-26', time: '11:00' })
  })

  it('starts a future day at 09:00', () => {
    expect(defaultFields('2026-10-02', now)).toEqual({ date: '2026-10-02', time: '09:00' })
  })

  it('moves a past day to today', () => {
    expect(defaultFields('2026-09-01', now)).toEqual({ date: '2026-09-26', time: '11:00' })
  })

  it('rolls over midnight', () => {
    expect(defaultFields(undefined, new Date(2026, 8, 26, 23, 30))).toEqual({
      date: '2026-09-27',
      time: '00:00'
    })
  })
})

describe('fields', () => {
  it('round-trips a local time, including on a DST change day', () => {
    // Europe/Lisbon goes back an hour on 25 October 2026.
    const instant = fromFields({ date: '2026-10-25', time: '18:45' })!
    expect(toFields(instant)).toEqual({ date: '2026-10-25', time: '18:45' })
    expect(instant.toISOString()).toBe('2026-10-25T18:45:00.000Z')
  })

  it('refuses incomplete fields', () => {
    expect(fromFields({ date: '2026-10-25', time: '' })).toBeNull()
    expect(fromFields({ date: '', time: '10:00' })).toBeNull()
  })
})
