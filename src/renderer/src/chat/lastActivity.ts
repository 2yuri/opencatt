import { differenceInCalendarDays, differenceInMinutes, format, isSameYear } from 'date-fns'

/**
 * When a chat was last written in, as the chat list shows it (OP-95): "now" under a minute,
 * then "5m", "2h" within the day, the weekday ("Tue") within the week, and "Sep 12" after that,
 * with the year once it is another year's. A time ahead of the clock counts as now.
 */
export function lastActivity(iso: string, now: Date = new Date()): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const minutes = differenceInMinutes(now, at)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`
  if (differenceInCalendarDays(now, at) < 7) return format(at, 'EEE')
  return format(at, isSameYear(now, at) ? 'MMM d' : 'MMM d, yyyy')
}
