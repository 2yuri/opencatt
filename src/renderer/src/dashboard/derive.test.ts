import { describe, expect, it } from 'vitest'
import type { PostStats, PostStatsRow, StatsSnapshot } from '@shared/api'
import {
  EMPTY_STATS,
  costOf,
  engagementRate,
  niceMax,
  shortNumber,
  shownPosts,
  sinceLast,
  sumStats,
  totalsOverTime
} from './derive'

const s = (impressions: number, likes = 0): PostStats => ({ ...EMPTY_STATS, impressions, likes })
const snap = (at: string, posts: [string, number][]): StatsSnapshot => ({
  at,
  totals: EMPTY_STATS,
  posts: posts.map(([remoteId, views]) => ({ remoteId, stats: s(views) }))
})

describe('dashboard numbers (OP-110)', () => {
  it("carries each post's last numbers forward, so a post leaving the window doesn't dip the line", () => {
    const series = totalsOverTime([
      snap('2026-09-01T10:00:00Z', [
        ['a', 100],
        ['b', 50]
      ]),
      // b fell out of the last 100: it still counts with its last 50.
      snap('2026-09-02T10:00:00Z', [
        ['a', 120],
        ['c', 10]
      ])
    ])
    expect(series.map((p) => p.totals.impressions)).toEqual([150, 180])
    expect(sinceLast(series)).toEqual({
      at: '2026-09-01T10:00:00Z',
      delta: { ...EMPTY_STATS, impressions: 30 }
    })
    expect(sinceLast(series.slice(0, 1))).toBeNull()
  })

  it('rates engagement per view, and keeps axis tops round', () => {
    expect(engagementRate({ ...s(200, 6), replies: 2 })).toBe(0.04)
    expect(engagementRate(s(0, 5))).toBe(0)
    expect(niceMax(30219)).toBe(30000)
    expect(niceMax(31500)).toBe(45000)
    expect(niceMax(8761)).toBe(9000)
    expect(shortNumber(30000)).toBe('30k')
    expect(shortNumber(1500)).toBe('1.5k')
  })
})

describe('the Made in OpenCatt switch (OP-112)', () => {
  const r = (remoteId: string, views: number, postId: string | null): PostStatsRow => ({
    remoteId,
    postId,
    text: remoteId,
    postedAt: '2026-09-30T10:00:00.000Z',
    stats: s(views, 1),
    statsAt: '2026-09-30T10:00:00.000Z',
    postingCost: postId ? 0.015 : null,
    postingEstimated: false,
    readsCost: 0.002
  })
  const rows = [r('a', 100, 'p1'), r('b', 900, null), r('c', 50, 'p2')]

  it('keeps only posts OpenCatt published, or all of them', () => {
    expect(shownPosts(rows, 'opencatt').map((x) => x.remoteId)).toEqual(['a', 'c'])
    expect(shownPosts(rows, 'all')).toBe(rows)
  })

  it('adds up the shown posts and what they cost', () => {
    const ours = shownPosts(rows, 'opencatt')
    expect(sumStats(ours)).toEqual({ ...EMPTY_STATS, impressions: 150, likes: 2 })
    expect(costOf(ours)).toBeCloseTo(0.034)
  })

  it('draws the line over only the given posts, still carried forward', () => {
    const history = [
      snap('2026-09-29T10:00:00.000Z', [
        ['a', 50],
        ['b', 500]
      ]),
      snap('2026-09-30T10:00:00.000Z', [
        ['b', 900],
        ['c', 50]
      ])
    ]
    const only = new Set(['a', 'c'])
    expect(totalsOverTime(history, only).map((t) => t.totals.impressions)).toEqual([50, 100])
  })
})
