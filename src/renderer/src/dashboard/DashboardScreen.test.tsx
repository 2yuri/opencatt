import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PostStatsRow, StatsSnapshot } from '@shared/api'
import { fakeApi } from '../test/fakeApi'
import { DashboardScreen } from './DashboardScreen'

afterEach(cleanup)

const stats = { impressions: 0, likes: 0, reposts: 0, replies: 0, quotes: 0, bookmarks: 0 }
const row = (
  remoteId: string,
  impressions: number,
  extra: Partial<PostStatsRow> = {}
): PostStatsRow => ({
  remoteId,
  postId: `p-${remoteId}`,
  text: `post ${remoteId}`,
  postedAt: `2026-09-2${remoteId}T10:00:00.000Z`,
  stats: { ...stats, impressions, likes: 4, replies: 1 },
  statsAt: '2026-09-30T14:32:00.000Z',
  postingCost: 0.015,
  postingEstimated: false,
  readsCost: 0.001,
  ...extra
})
const snapshot = (at: string, rows: PostStatsRow[]): StatsSnapshot => ({
  at,
  totals: stats,
  posts: rows.map((r) => ({ remoteId: r.remoteId, stats: r.stats }))
})

function setup() {
  const fake = fakeApi()
  window.opencat = fake.api
  return fake
}

describe('DashboardScreen (OP-110)', () => {
  it('reads nothing on open, offers Load stats with its cost, and shows the loaded numbers', async () => {
    const fake = setup()
    fake.stats.filter = 'all'
    const rows = [row('1', 1200), row('2', 800, { postId: null, postingCost: null })]
    fake.stats.nextSync = { rows, snapshot: snapshot('2026-09-30T14:32:00.000Z', rows) }
    render(<DashboardScreen />)

    const load = await screen.findByRole('button', { name: 'Load stats · about $0.10' })
    expect(fake.api.stats.sync).not.toHaveBeenCalled()
    expect(screen.getAllByText('No posts read yet')).toHaveLength(2)

    fireEvent.click(load)
    await waitFor(() => expect(screen.getByTestId('views-total').textContent).toBe('2,000'))
    expect(fake.api.stats.sync).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Refresh · about \$0\.10/ })).toBeTruthy()
    expect(screen.getByText(/First refresh · 30 Sep/)).toBeTruthy()
    expect(screen.getByText('Refresh again later to see views grow')).toBeTruthy()

    const top = screen.getAllByTestId('top-post')
    expect(top.map((li) => within(li).getByText(/^post /).textContent)).toEqual([
      'post 1',
      'post 2'
    ])
    expect(top[1]!.textContent).toContain('posted outside OpenCatt')
  })

  it('shows growth since the previous refresh from the carried-forward totals', async () => {
    const fake = setup()
    const before = [row('1', 1000)]
    const after = [row('1', 1300), row('2', 200)]
    fake.stats.rows = after
    fake.stats.history = [
      snapshot('2026-09-29T10:00:00.000Z', before),
      snapshot('2026-09-30T10:00:00.000Z', after)
    ]
    fake.stats.lastSync = { at: '2026-09-30T10:00:00.000Z', spent: 0.002 }
    render(<DashboardScreen />)
    await waitFor(() => expect(screen.getByTestId('views-total').textContent).toBe('1,500'))
    expect(screen.getByText('+500')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Total views at each refresh' })).toBeTruthy()
  })

  it("says plainly when X won't read, keeps the last numbers, and offers Try again", async () => {
    const fake = setup()
    fake.stats.rows = [row('1', 900)]
    fake.stats.history = [snapshot('2026-09-30T10:00:00.000Z', fake.stats.rows)]
    fake.stats.lastSync = { at: '2026-09-30T10:00:00.000Z', spent: 0.001 }
    fake.stats.nextSync = new Error(
      "Error invoking remote method 'stats:sync': Error: Your X plan can't read posts. Reading stats needs pay-per-use or a paid plan."
    )
    render(<DashboardScreen />)
    fireEvent.click(await screen.findByRole('button', { name: /Refresh/ }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Your X plan can't read posts.")
    expect(alert.textContent).toContain('The numbers below are from your last sync.')
    expect(screen.getByTestId('views-total').textContent).toBe('900')
    expect(within(alert).getByRole('button', { name: /^Try again · about \$/ })).toBeTruthy()
  })
})

describe('DashboardScreen switch (OP-112)', () => {
  const outside = (remoteId: string, impressions: number): PostStatsRow =>
    row(remoteId, impressions, { postId: null, postingCost: null })

  function loaded(rows: PostStatsRow[], history: StatsSnapshot[]) {
    const fake = setup()
    fake.stats.rows = rows
    fake.stats.history = history
    fake.stats.lastSync = { at: '2026-09-30T10:00:00.000Z', spent: 0.003 }
    return fake
  }

  it('opens on Made in OpenCatt: totals, growth and list leave out posts made elsewhere', async () => {
    const before = [row('1', 1000), outside('2', 5000)]
    const after = [row('1', 1300), outside('2', 9000), row('3', 200)]
    loaded(after, [
      snapshot('2026-09-29T10:00:00.000Z', before),
      snapshot('2026-09-30T10:00:00.000Z', after)
    ])
    render(<DashboardScreen />)
    await waitFor(() => expect(screen.getByTestId('views-total').textContent).toBe('1,500'))
    expect(screen.getByText('OpenCatt posts in the last 100')).toBeTruthy()
    expect(screen.getByText('+500')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Made in OpenCatt' }).getAttribute('aria-pressed')
    ).toBe('true')
    expect(screen.getAllByTestId('top-post')).toHaveLength(2)
    expect(screen.getByText('Last 14 OpenCatt posts, oldest to newest')).toBeTruthy()
  })

  it('keeps Spent on X at what X charged and says what these posts cost under it', async () => {
    loaded([row('1', 1000), outside('2', 5000)], [])
    render(<DashboardScreen />)
    // posting 0.015 + reads 0.001 × 2 = 0.017 in all; the OpenCatt post is 0.016 of it.
    expect(await screen.findByText('$0.016 on these posts')).toBeTruthy()
    expect(screen.getByText('$0.017')).toBeTruthy()
  })

  it('switches to All posts and saves the choice', async () => {
    const fake = loaded([row('1', 1000), outside('2', 5000)], [])
    render(<DashboardScreen />)
    await waitFor(() => expect(screen.getByTestId('views-total').textContent).toBe('1,000'))
    fireEvent.click(screen.getByRole('button', { name: 'All posts' }))
    expect(screen.getByTestId('views-total').textContent).toBe('6,000')
    expect(screen.getByText('posts $0.015 · reads $0.002')).toBeTruthy()
    expect(fake.api.stats.filter.set).toHaveBeenCalledWith('all')
    expect(fake.api.stats.sync).not.toHaveBeenCalled()
  })

  it('opens on the saved choice', async () => {
    const fake = loaded([row('1', 1000), outside('2', 5000)], [])
    fake.stats.filter = 'all'
    render(<DashboardScreen />)
    await waitFor(() => expect(screen.getByTestId('views-total').textContent).toBe('6,000'))
    expect(screen.getByRole('button', { name: 'All posts' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('says so when none of the last 100 were made in OpenCatt, and offers all posts', async () => {
    loaded([outside('1', 1000), outside('2', 5000)], [])
    render(<DashboardScreen />)
    const panel = await screen.findByRole('region', { name: 'No OpenCatt posts' })
    expect(panel.textContent).toContain('None of your last 100 posts were made in OpenCatt.')
    expect(screen.getByTestId('views-total').textContent).toBe('0')
    expect(screen.queryByTestId('top-post')).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: 'Show all posts' }))
    expect(screen.getByTestId('views-total').textContent).toBe('6,000')
    expect(screen.getAllByTestId('top-post')).toHaveLength(2)
  })
})

describe('DashboardScreen at narrow widths (OP-114)', () => {
  it('lets Top posts drop the bar, then reactions, then cost by its own width, never the views', async () => {
    const fake = setup()
    fake.stats.filter = 'all'
    fake.stats.rows = [row('1', 900)]
    fake.stats.lastSync = { at: '2026-09-30T10:00:00.000Z', spent: 0.001 }
    render(<DashboardScreen />)
    const item = (await screen.findAllByTestId('top-post'))[0]!
    expect(item.closest('section')!.className).toContain('@container')
    const shownFrom = (id: string): string =>
      within(item)
        .getByTestId(id)
        .className.split(' ')
        .filter((c) => c === 'hidden' || c.startsWith('@min-'))
        .join(' ')
    expect(shownFrom('top-post-bar')).toBe('hidden @min-[720px]:block')
    expect(shownFrom('top-post-reactions')).toBe('hidden @min-[560px]:flex')
    expect(shownFrom('top-post-cost')).toBe('hidden @min-[420px]:block')
    expect(within(item).getByText('900').className).not.toContain('hidden')
  })

  it('keeps the charts from holding the page open when it narrows', async () => {
    const fake = setup()
    fake.stats.rows = [row('1', 900)]
    fake.stats.history = [snapshot('2026-09-30T10:00:00.000Z', fake.stats.rows)]
    fake.stats.lastSync = { at: '2026-09-30T10:00:00.000Z', spent: 0.001 }
    render(<DashboardScreen />)
    const charts = await screen.findAllByRole('img')
    for (const chart of charts)
      expect(chart.parentElement!.className).toContain('[contain:inline-size]')
  })
})
