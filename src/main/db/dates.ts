import type { LocalDate } from '@shared/api'

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Parses a local date and returns local midnight of that day. */
export function startOfLocalDay(date: LocalDate): Date {
  const match = LOCAL_DATE.exec(date)
  if (!match) throw new Error(`Expected a date like 2026-09-28, got "${date}"`)
  const [, y, m, d] = match
  const start = new Date(Number(y), Number(m) - 1, Number(d))
  if (start.getDate() !== Number(d)) throw new Error(`"${date}" is not a real date`)
  return start
}

/** Local midnight of the following day. Built from the calendar, not +24h, so DST days work. */
export function startOfNextLocalDay(date: LocalDate): Date {
  const start = startOfLocalDay(date)
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1)
}

export function toLocalDate(instant: Date): LocalDate {
  const y = instant.getFullYear()
  const m = String(instant.getMonth() + 1).padStart(2, '0')
  const d = String(instant.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Normalises any parseable timestamp to a UTC ISO string, which sorts correctly as text. */
export function toUtcIso(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime()))
    throw new Error(`"${String(value)}" is not a valid date and time`)
  return date.toISOString()
}
