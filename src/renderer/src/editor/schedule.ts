import { addHours, format, isBefore, isValid, parse, startOfHour } from 'date-fns'
import type { LocalDate } from '@shared/api'

export interface DateTimeFields {
  date: LocalDate
  time: string
}

/** The local date and time fields for an instant. */
export function toFields(instant: Date): DateTimeFields {
  return { date: format(instant, 'yyyy-MM-dd'), time: format(instant, 'HH:mm') }
}

/** The instant the fields mean in the user's timezone, or null when they are incomplete. */
export function fromFields({ date, time }: DateTimeFields): Date | null {
  if (!date || !time) return null
  const instant = parse(`${date} ${time}`, 'yyyy-MM-dd HH:mm', new Date())
  return isValid(instant) ? instant : null
}

/**
 * Where a new post starts: the next full hour today, or 09:00 on a future day.
 * A day in the past falls back to today, since nothing can be scheduled there.
 */
export function defaultFields(day: LocalDate | undefined, now: Date): DateTimeFields {
  const nextHour = toFields(addHours(startOfHour(now), 1))
  if (!day || day <= toFields(now).date) return nextHour
  return { date: day, time: '09:00' }
}

export function isPast(instant: Date, now: Date): boolean {
  return isBefore(instant, now)
}
