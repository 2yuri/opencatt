import { useCallback, useEffect, useState } from 'react'
import { WEEK_START_SETTING, type WeekDay, type WeekStartSetting } from '@shared/api'
import { DEFAULT_WEEK_START } from './grid'

export function resolveWeekStart(setting: WeekStartSetting, system: WeekDay): WeekDay {
  if (setting === 'monday') return 1
  if (setting === 'sunday') return 0
  return system
}

function readSetting(value: unknown): WeekStartSetting {
  return value === 'monday' || value === 'sunday' ? value : 'auto'
}

/** The calendar's first day: the user's choice, or the OS region's when it is Auto. */
export function useWeekStart(): {
  weekStartsOn: WeekDay
  system: WeekDay
  setting: WeekStartSetting
  choose: (setting: WeekStartSetting) => void
} {
  const [system, setSystem] = useState<WeekDay>(DEFAULT_WEEK_START)
  const [setting, setSetting] = useState<WeekStartSetting>('auto')

  useEffect(() => {
    let current = true
    Promise.all([
      window.opencat.locale.weekStart(),
      window.opencat.settings.get(WEEK_START_SETTING)
    ])
      .then(([day, saved]) => {
        if (!current) return
        setSystem(day)
        setSetting(readSetting(saved))
      })
      // Monday is a fine calendar if the locale can't be read.
      .catch(() => {})
    return () => {
      current = false
    }
  }, [])

  const choose = useCallback((next: WeekStartSetting) => {
    setSetting(next)
    void window.opencat.settings.set(WEEK_START_SETTING, next === 'auto' ? null : next)
  }, [])

  return { weekStartsOn: resolveWeekStart(setting, system), system, setting, choose }
}
