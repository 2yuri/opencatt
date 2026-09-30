import type { PostStats, PostStatsRow, StatsFilter, StatsSnapshot } from '@shared/api'

export const EMPTY_STATS: PostStats = {
  impressions: 0,
  likes: 0,
  reposts: 0,
  replies: 0,
  quotes: 0,
  bookmarks: 0
}

const KEYS = Object.keys(EMPTY_STATS) as (keyof PostStats)[]

export interface TotalsAt {
  at: string
  totals: PostStats
}

/**
 * The account's totals at each refresh, oldest first. A refresh only reads the last 100 posts,
 * so each post's last known numbers are carried forward: a post that drops out of the window
 * keeps counting, and the line only moves when posts actually grow or new ones arrive. With
 * `only`, just those posts count (the switch's OpenCatt posts).
 */
export function totalsOverTime(history: StatsSnapshot[], only?: Set<string>): TotalsAt[] {
  const latest = new Map<string, PostStats>()
  return history.map((snap) => {
    for (const post of snap.posts) {
      if (!only || only.has(post.remoteId)) latest.set(post.remoteId, post.stats)
    }
    const totals = { ...EMPTY_STATS }
    for (const stats of latest.values()) for (const key of KEYS) totals[key] += stats[key]
    return { at: snap.at, totals }
  })
}

/** The posts the Dashboard's switch shows (OP-112): all, or only those OpenCatt published. */
export function shownPosts(rows: PostStatsRow[], filter: StatsFilter): PostStatsRow[] {
  return filter === 'all' ? rows : rows.filter((row) => row.postId !== null)
}

/** The posts' numbers added up. */
export function sumStats(rows: PostStatsRow[]): PostStats {
  const totals = { ...EMPTY_STATS }
  for (const row of rows) for (const key of KEYS) totals[key] += row.stats[key]
  return totals
}

/** What posting and reading these posts has cost. */
export function costOf(rows: PostStatsRow[]): number {
  return rows.reduce((sum, row) => sum + (row.postingCost ?? 0) + row.readsCost, 0)
}

/** How much each number grew since the refresh before the last one; null after only one. */
export function sinceLast(series: TotalsAt[]): { at: string; delta: PostStats } | null {
  if (series.length < 2) return null
  const now = series[series.length - 1]!.totals
  const before = series[series.length - 2]!
  const delta = { ...EMPTY_STATS }
  for (const key of KEYS) delta[key] = now[key] - before.totals[key]
  return { at: before.at, delta }
}

/** Likes, reposts, replies, quotes and bookmarks per view; 0 for a post with no views. */
export function engagementRate(stats: PostStats): number {
  if (stats.impressions <= 0) return 0
  return (
    (stats.likes + stats.reposts + stats.replies + stats.quotes + stats.bookmarks) /
    stats.impressions
  )
}

/** The average of the posts' rates, each post counting once. */
export function averageRate(rows: PostStatsRow[]): number {
  if (rows.length === 0) return 0
  return rows.reduce((sum, row) => sum + engagementRate(row.stats), 0) / rows.length
}

/** The newest `count` posts, oldest to newest, for the per-post charts. */
export function recentPosts(rows: PostStatsRow[], count = 14): PostStatsRow[] {
  return [...rows].sort((a, b) => a.postedAt.localeCompare(b.postedAt)).slice(-count)
}

/** The posts with the most views, most first. */
export function topPosts(rows: PostStatsRow[], count = 5): PostStatsRow[] {
  return [...rows].sort((a, b) => b.stats.impressions - a.stats.impressions).slice(0, count)
}

/**
 * A round top for a chart's axis, with `steps` even gridlines below it. A value up to 3% over a
 * round step keeps that step, as in the frames (30,219 sits just above a 30k top line).
 */
export function niceMax(value: number, steps = 3): number {
  if (value <= 0) return steps
  const raw = (value * 0.97) / steps
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step =
    [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw
  return step * steps
}

/** 30219 → "30k", 8761 → "8.8k", 900 → "900". */
export function shortNumber(value: number): string {
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`
  if (value >= 1000) return `${trim(value / 1000)}k`
  return String(Math.round(value))
}

const trim = (n: number): string =>
  n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '')
