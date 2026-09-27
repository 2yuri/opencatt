import type { WeekDay } from '@shared/api'

const MONDAY: WeekDay = 1

interface WeekInfoLocale {
  getWeekInfo?: () => { firstDay: number }
  weekInfo?: { firstDay: number }
}

/**
 * The first day of the week for a BCP 47 locale such as en-US or pt-PT.
 * Intl numbers days 1 (Monday) to 7 (Sunday); date-fns uses 0 (Sunday) to 6.
 */
export function weekStartFor(locale: string): WeekDay {
  try {
    const intl = new Intl.Locale(locale) as unknown as WeekInfoLocale
    // getWeekInfo() is the current API; older V8 had a weekInfo getter.
    const firstDay = intl.getWeekInfo?.().firstDay ?? intl.weekInfo?.firstDay
    if (firstDay === undefined || firstDay < 1 || firstDay > 7) return MONDAY
    return (firstDay % 7) as WeekDay
  } catch {
    return MONDAY
  }
}
