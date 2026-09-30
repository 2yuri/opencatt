import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PostStatsRow,
  StatsEstimate,
  StatsFilter,
  StatsSnapshot,
  StatsTotals,
  XPrices
} from '@shared/api'
import { messageOf } from '../chat/useAgentChat'

export interface Stats {
  /** False until main first answers. */
  loaded: boolean
  estimate: StatsEstimate | null
  rows: PostStatsRow[]
  totals: StatsTotals | null
  history: StatsSnapshot[]
  lastSync: { at: string; spent: number } | null
  prices: XPrices | null
  /** Which posts to show (OP-112), saved per account. */
  filter: StatsFilter
  syncing: boolean
  /** Why the last refresh failed, in main's words; cleared by the next one. */
  error: string | null
  refresh(): Promise<void>
  setFilter(filter: StatsFilter): void
}

/**
 * The active account's stats and costs (OP-110), from OP-109's window.opencat.stats. Nothing is
 * read from X here: only refresh() does, when the user presses the button. It reloads when main
 * says stats or prices changed, and when the active X account changes.
 */
export function useStats(): Stats {
  const [data, setData] = useState<Omit<Stats, 'syncing' | 'error' | 'refresh' | 'setFilter'>>({
    loaded: false,
    estimate: null,
    rows: [],
    totals: null,
    history: [],
    lastSync: null,
    prices: null,
    filter: 'opencatt'
  })
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only the latest load lands, so a slow answer never puts back older numbers.
  const seq = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const n = ++seq.current
    const { stats } = window.opencat
    const [estimate, rows, totals, history, lastSync, prices, filter] = await Promise.all([
      stats.estimate(),
      stats.list(),
      stats.totals(),
      stats.history(),
      stats.lastSync(),
      stats.prices.get(),
      stats.filter.get()
    ])
    if (n !== seq.current) return
    setData({ loaded: true, estimate, rows, totals, history, lastSync, prices, filter })
  }, [])

  useEffect(() => {
    let live = true
    const reload = (): void => void load().catch((err: unknown) => live && setError(messageOf(err)))
    reload()
    const stopStats = window.opencat.stats.onChanged(reload)
    // Another account, another dashboard; its own error, if any, comes with its own refresh.
    const stopAuth = window.opencat.auth?.onChanged(() => {
      setError(null)
      reload()
    })
    return () => {
      live = false
      seq.current++
      stopStats()
      stopAuth?.()
    }
  }, [load])

  const refresh = useCallback(async (): Promise<void> => {
    setSyncing(true)
    setError(null)
    try {
      await window.opencat.stats.sync()
      await load()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setSyncing(false)
    }
  }, [load])

  const setFilter = useCallback((filter: StatsFilter): void => {
    setData((d) => ({ ...d, filter }))
    window.opencat.stats.filter.set(filter).catch((err: unknown) => setError(messageOf(err)))
  }, [])

  return { ...data, syncing, error, refresh, setFilter }
}
