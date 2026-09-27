import { describe, expect, it } from 'vitest'
import { lastActivity } from './lastActivity'

describe('lastActivity', () => {
  // A Sunday afternoon.
  const now = new Date(2026, 8, 27, 15, 30)
  const ago = (minutes: number): string => new Date(now.getTime() - minutes * 60_000).toISOString()

  it('says now under a minute, and for a time ahead of the clock', () => {
    expect(lastActivity(ago(0), now)).toBe('now')
    expect(lastActivity(ago(0.5), now)).toBe('now')
    expect(lastActivity(ago(-5), now)).toBe('now')
  })

  it('counts minutes under the hour, then hours within the day', () => {
    expect(lastActivity(ago(1), now)).toBe('1m')
    expect(lastActivity(ago(5), now)).toBe('5m')
    expect(lastActivity(ago(59), now)).toBe('59m')
    expect(lastActivity(ago(60), now)).toBe('1h')
    expect(lastActivity(ago(2 * 60 + 40), now)).toBe('2h')
    expect(lastActivity(ago(23 * 60 + 59), now)).toBe('23h')
  })

  it('names the weekday within the week, then the date', () => {
    expect(lastActivity(new Date(2026, 8, 22, 9, 0).toISOString(), now)).toBe('Tue')
    expect(lastActivity(new Date(2026, 8, 21, 9, 0).toISOString(), now)).toBe('Mon')
    expect(lastActivity(new Date(2026, 8, 20, 9, 0).toISOString(), now)).toBe('Sep 20')
    expect(lastActivity(new Date(2026, 8, 12, 9, 0).toISOString(), now)).toBe('Sep 12')
  })

  it('adds the year for another year, and leaves a bad date blank', () => {
    expect(lastActivity(new Date(2025, 11, 30, 9, 0).toISOString(), now)).toBe('Dec 30, 2025')
    expect(lastActivity('not a date', now)).toBe('')
  })
})
