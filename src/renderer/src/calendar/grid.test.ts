import { describe, expect, it } from 'vitest'
import {
  chipsThatFit,
  gridDays,
  gridRange,
  parseLocalDate,
  shiftAnchor,
  toLocalDate,
  viewTitle,
  weekdayLabels
} from './grid'

const day = (value: string): Date => parseLocalDate(value)!
const dates = (days: Date[]): string[] => days.map(toLocalDate)

describe('gridDays', () => {
  it('fills a month with six Monday-first weeks, including days of the months around it', () => {
    const days = dates(gridDays('month', day('2026-09-15')))
    expect(days).toHaveLength(42)
    expect(days[0]).toBe('2026-08-31')
    expect(days.at(-1)).toBe('2026-10-11')
  })

  it('starts on the 1st when the month starts on a Monday', () => {
    expect(toLocalDate(gridDays('month', day('2026-06-20'))[0])).toBe('2026-06-01')
  })

  it('includes 29 February in a leap year', () => {
    const days = dates(gridDays('month', day('2028-02-10')))
    expect(days).toContain('2028-02-29')
    expect(days[days.indexOf('2028-02-29') + 1]).toBe('2028-03-01')
  })

  it('gives one cell per calendar day across a DST change', () => {
    // Europe/Lisbon (see vitest.config.ts) goes back an hour on 25 October 2026.
    const days = gridDays('month', day('2026-10-01'))
    expect(new Set(dates(days)).size).toBe(42)
    for (const d of days) expect(d.getHours()).toBe(0)
    expect(dates(days)).toContain('2026-10-25')
    expect(dates(days)).toContain('2026-10-26')
  })

  it('shows Monday to Sunday of the anchor week', () => {
    expect(dates(gridDays('week', day('2026-09-26')))).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27'
    ])
  })

  it('treats a Sunday as the end of its week', () => {
    expect(toLocalDate(gridDays('week', day('2026-09-27'))[0])).toBe('2026-09-21')
  })
})

describe('gridRange', () => {
  it('spans the first and last cell', () => {
    expect(gridRange('week', day('2026-12-31'))).toEqual({ from: '2026-12-28', to: '2027-01-03' })
  })
})

describe('shiftAnchor', () => {
  it('moves a month from the 31st without skipping a month', () => {
    expect(toLocalDate(shiftAnchor('month', day('2026-01-31'), 1))).toBe('2026-02-28')
  })

  it('moves a week back across a year', () => {
    expect(toLocalDate(shiftAnchor('week', day('2027-01-02'), -1))).toBe('2026-12-26')
  })
})

describe('parseLocalDate', () => {
  it.each(['', '2026-02-30', '2026-13-01', '26-09-01', 'tomorrow', null, undefined])(
    'refuses %s',
    (value) => {
      expect(parseLocalDate(value)).toBeNull()
    }
  )
})

describe('viewTitle', () => {
  it('names the month', () => {
    expect(viewTitle('month', day('2026-09-26'))).toBe('September 2026')
    expect(viewTitle('month', day('2026-09-26'), 0, true)).toBe('Sep 2026')
  })

  it('names a week inside one month, across months and across years', () => {
    expect(viewTitle('week', day('2026-09-23'))).toBe('21 – 27 Sep 2026')
    expect(viewTitle('week', day('2026-09-30'))).toBe('28 Sep – 4 Oct 2026')
    expect(viewTitle('week', day('2026-12-30'))).toBe('28 Dec 2026 – 3 Jan 2027')
  })
})

describe('week start', () => {
  it('starts a month grid on Sunday', () => {
    const days = dates(gridDays('month', day('2026-09-15'), 0))
    expect(days[0]).toBe('2026-08-30')
    expect(days).toHaveLength(42)
  })

  it('starts a week on Saturday', () => {
    expect(gridRange('week', day('2026-09-23'), 6)).toEqual({
      from: '2026-09-19',
      to: '2026-09-25'
    })
  })

  it('titles the week it shows', () => {
    expect(viewTitle('week', day('2026-09-26'), 0)).toBe('20 – 26 Sep 2026')
  })

  it('labels weekdays in grid order', () => {
    expect(weekdayLabels(0, 'en-US')).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    expect(weekdayLabels(1, 'en-US')[0]).toBe('Mon')
    expect(weekdayLabels(1, 'pt-PT')[0]).toMatch(/^seg/)
  })
})

describe('chipsThatFit', () => {
  it('shows up to the cap when the height is not known', () => {
    expect(chipsThatFit(Number.POSITIVE_INFINITY, 5, 3)).toBe(3)
    expect(chipsThatFit(Number.POSITIVE_INFINITY, 2, 3)).toBe(2)
  })

  it('shows every chip when they all fit, without room for "+N more"', () => {
    // 33 chrome + 3 chips of 28.
    expect(chipsThatFit(117, 3, 3)).toBe(3)
    expect(chipsThatFit(160, 3, 3)).toBe(3)
  })

  it('keeps room for "+N more" when some are left out', () => {
    expect(chipsThatFit(116, 3, 3)).toBe(2)
    // A 600px-tall window: an 80px cell fits one chip and "+N more".
    expect(chipsThatFit(80, 5, 3)).toBe(1)
    expect(chipsThatFit(78, 5, 3)).toBe(0)
  })

  it('never shows more than the cap', () => {
    expect(chipsThatFit(1000, 20, 12)).toBe(12)
  })
})
