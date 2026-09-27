import {
  addDays,
  addMonths,
  addWeeks,
  endOfWeek,
  format,
  isValid,
  parse,
  startOfMonth,
  startOfWeek
} from 'date-fns'
import type { LocalDate, WeekDay } from '@shared/api'

export type CalendarView = 'month' | 'week'

/** Monday, for tests and until the system's week start has loaded. */
export const DEFAULT_WEEK_START: WeekDay = 1

/** Six weeks, so every month fits and the grid never changes height. */
const MONTH_CELLS = 42

export function toLocalDate(day: Date): LocalDate {
  return format(day, 'yyyy-MM-dd')
}

/** Local midnight of a YYYY-MM-DD date, or null when it is not a real date. */
export function parseLocalDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const day = parse(value, 'yyyy-MM-dd', new Date())
  return isValid(day) && toLocalDate(day) === value ? day : null
}

/** The days shown for a view, as local midnights. addDays steps by calendar day, so DST is safe. */
export function gridDays(
  view: CalendarView,
  anchor: Date,
  weekStartsOn: WeekDay = DEFAULT_WEEK_START
): Date[] {
  const week = { weekStartsOn }
  const first =
    view === 'month' ? startOfWeek(startOfMonth(anchor), week) : startOfWeek(anchor, week)
  const count = view === 'month' ? MONTH_CELLS : 7
  return Array.from({ length: count }, (_, i) => addDays(first, i))
}

export function gridRange(
  view: CalendarView,
  anchor: Date,
  weekStartsOn: WeekDay = DEFAULT_WEEK_START
): { from: LocalDate; to: LocalDate } {
  const days = gridDays(view, anchor, weekStartsOn)
  return { from: toLocalDate(days[0]), to: toLocalDate(days[days.length - 1]) }
}

export function shiftAnchor(view: CalendarView, anchor: Date, step: 1 | -1): Date {
  return view === 'month' ? addMonths(anchor, step) : addWeeks(anchor, step)
}

export function viewTitle(
  view: CalendarView,
  anchor: Date,
  weekStartsOn: WeekDay = DEFAULT_WEEK_START,
  short = false
): string {
  if (view === 'month') return format(anchor, short ? 'MMM yyyy' : 'MMMM yyyy')
  const start = startOfWeek(anchor, { weekStartsOn })
  const end = endOfWeek(anchor, { weekStartsOn })
  const sameMonth = start.getMonth() === end.getMonth()
  const sameYear = start.getFullYear() === end.getFullYear()
  const left = format(start, sameMonth ? 'd' : sameYear ? 'd MMM' : 'd MMM yyyy')
  return `${left} – ${format(end, 'd MMM yyyy')}`
}

/** Short weekday names in the user's language, in grid order. */
export function weekdayLabels(
  weekStartsOn: WeekDay = DEFAULT_WEEK_START,
  locale?: string
): string[] {
  const name = new Intl.DateTimeFormat(locale, { weekday: 'short' })
  return gridDays('week', new Date(), weekStartsOn).map((day) => name.format(day))
}

/** A cell's padding (6px top, 4px bottom), its 22px day number and its 1px bottom border. */
const CELL_CHROME = 33
/** A chip: 24px, and the 4px gap above it. */
const CHIP_STEP = 28
/** The "+N more" line: 14px, and the 4px gap above it. */
const MORE_STEP = 18

/**
 * How many of `count` chips to show in a cell `height` px tall (border box): as many as fit,
 * at most `max`, leaving room for "+N more" when some are left out. An unknown height
 * (Infinity) shows up to `max`.
 */
export function chipsThatFit(height: number, count: number, max: number): number {
  const cap = Math.min(count, max)
  if (!Number.isFinite(height)) return cap
  for (let k = cap; k > 0; k--) {
    const more = count > k ? MORE_STEP : 0
    if (CELL_CHROME + k * CHIP_STEP + more <= height) return k
  }
  return 0
}
