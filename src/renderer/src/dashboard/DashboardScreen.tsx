import { format, isToday, parseISO } from 'date-fns'
import {
  ArrowUpRight,
  ChartColumn,
  CircleAlert,
  Filter,
  Heart,
  History,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  TrendingUp
} from 'lucide-react'
import type { PostStats, PostStatsRow, StatsFilter } from '@shared/api'
import { useActiveAccount } from '../shell/useActiveAccount'
import { Button, Segmented, SegmentedItem } from '../ui'
import { BarChart, LineChart } from './charts'
import {
  averageRate,
  costOf,
  engagementRate,
  recentPosts,
  shownPosts,
  sinceLast,
  sumStats,
  topPosts,
  totalsOverTime
} from './derive'
import { useStats } from './useStats'

const number = new Intl.NumberFormat('en-US')
const dollars = (n: number): string => `$${n < 0.1 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`
const percent = (n: number): string => `${(n * 100).toFixed(1).replace(/\.0$/, '')}%`
const when = (at: string): string =>
  isToday(new Date(at))
    ? `${format(new Date(at), 'HH:mm')} today`
    : format(new Date(at), 'd MMM HH:mm')

/**
 * The Dashboard (OP-110): the active account's views and engagement from X, as charts and per
 * post, with what posting and reading has cost. Nothing is read from X until the user presses
 * Load stats or Refresh, and the button says what that will cost first.
 */
export function DashboardScreen(): React.JSX.Element {
  const stats = useStats()
  const { active } = useActiveAccount()
  const ours = stats.filter === 'opencatt'
  const rows = shownPosts(stats.rows, stats.filter)
  const series = totalsOverTime(
    stats.history,
    ours ? new Set(rows.map((r) => r.remoteId)) : undefined
  )
  const since = sinceLast(series)
  const empty = stats.loaded && !stats.lastSync
  const cost = stats.estimate ? `about ${dollars(stats.estimate.dollars)}` : ''
  const asOf = stats.prices ? format(parseISO(stats.prices.asOf), 'd MMM yyyy') : ''
  const pricing = stats.prices?.sourceUrl ?? 'https://docs.x.com/x-api/getting-started/pricing'
  const last = series[series.length - 1]
  // Posts were read, but none of them came from OpenCatt: one panel instead of empty charts.
  const noneOurs = ours && !empty && stats.loaded && !!stats.lastSync && rows.length === 0

  return (
    <main className="flex h-full min-h-0 flex-col" aria-labelledby="dashboard-title">
      {/* The header also answers to its own width (OP-114): with the chat panel open it drops the
          handle, then the last-synced time, and shortens Refresh, but always shows the cost. */}
      <header className="@container relative flex h-[60px] shrink-0 items-center gap-3 border-b border-ds-border px-5 whitespace-nowrap">
        <h1 id="dashboard-title" className="m-0 text-[20px] font-semibold tracking-[-0.4px]">
          Dashboard
        </h1>
        {active && (
          <span className="hidden text-[14px] text-ds-text-3 @min-[640px]:inline">
            @{active.handle}
          </span>
        )}
        {stats.lastSync && <FilterSwitch value={stats.filter} onChange={stats.setFilter} />}
        <span className="flex-1" />
        {stats.lastSync && (
          <span className="hidden text-[12px] text-ds-text-3 @min-[780px]:inline">
            Last synced {when(stats.lastSync.at)}
          </span>
        )}
        {!empty && (
          <Button
            type="button"
            disabled={stats.syncing || !stats.loaded}
            onClick={() => void stats.refresh()}
            title={stats.lastSync ? `Last synced ${when(stats.lastSync.at)}` : undefined}
            aria-label={stats.syncing ? undefined : `Refresh${cost ? ` · ${cost}` : ''}`}
          >
            {stats.syncing ? (
              <>
                <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
                Reading 100 posts…
              </>
            ) : (
              <>
                <RefreshCw size={14} aria-hidden="true" />
                {/* Short when the header is narrow; the cost always shows. */}
                <span aria-hidden="true" className="@min-[560px]:hidden">
                  Refresh{stats.estimate ? ` · ${dollars(stats.estimate.dollars)}` : ''}
                </span>
                <span aria-hidden="true" className="hidden @min-[560px]:inline">
                  Refresh{cost ? ` · ${cost}` : ''}
                </span>
              </>
            )}
          </Button>
        )}
        {stats.syncing && (
          <span
            className="absolute inset-x-0 -bottom-px h-[2px] overflow-hidden"
            role="progressbar"
            aria-label="Reading your posts from X"
          >
            <span className="block h-full w-1/3 animate-[dashboard-progress_1.4s_ease-in-out_infinite] bg-ds-accent" />
          </span>
        )}
      </header>

      <div
        className={`@container flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-8 pt-2 pb-8 ${stats.syncing ? 'opacity-60' : ''}`}
      >
        {!empty && !stats.error && (
          <p className="m-0 flex justify-end gap-1 text-[11px] text-ds-text-3">
            Reads your last 100 posts from X. Estimated, prices as of {asOf} ·{' '}
            <PricingLink href={pricing} />
          </p>
        )}
        {stats.error && (
          <div
            role="alert"
            className="mt-2 flex items-center gap-3 rounded-xl bg-ds-red-2 px-5 py-3"
          >
            <CircleAlert size={18} className="shrink-0 text-ds-red" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[14px] text-ds-red">{stats.error}</span>
              <span className="text-[12px] text-ds-text-2">
                {stats.lastSync
                  ? 'Nothing was charged. The numbers below are from your last sync.'
                  : 'Nothing was charged.'}
              </span>
            </span>
            <PricingLink href={pricing} className="text-[13px]" />
            <Button type="button" onClick={() => void stats.refresh()} disabled={stats.syncing}>
              {cost ? `Try again · ${cost}` : 'Try again'}
            </Button>
          </div>
        )}

        <Summary stats={stats} rows={rows} since={since} lastAt={last?.at} />

        {noneOurs ? (
          <NoneOurs onShowAll={() => stats.setFilter('all')} />
        ) : (
          <>
            <section aria-labelledby="over-time" className="flex flex-col gap-3">
              <Heading
                id="over-time"
                title="Views over time"
                sub={
                  empty
                    ? 'Total views at each refresh · appears after your first load'
                    : series.length === 1
                      ? 'Total views at each refresh · 1 refresh so far'
                      : 'Total views at each refresh'
                }
              />
              {empty ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <p className="m-0 text-[14px] text-ds-text-2">
                    See how your posts do on X. The first load reads your last 100 posts.
                  </p>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={stats.syncing}
                    onClick={() => void stats.refresh()}
                  >
                    {stats.syncing ? (
                      <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <ChartColumn size={14} aria-hidden="true" />
                    )}
                    {stats.syncing ? 'Reading 100 posts…' : `Load stats · ${cost}`}
                  </Button>
                  <span className="text-[11px] text-ds-text-3">
                    Estimated, prices as of {asOf} · <PricingLink href={pricing} />
                  </span>
                </div>
              ) : (
                series.length > 0 && (
                  <LineChart
                    points={series.map((s) => ({
                      at: new Date(s.at),
                      value: s.totals.impressions
                    }))}
                  />
                )
              )}
            </section>

            <PerPost rows={rows} ours={ours} />
            {rows.length > 0 && <Posts rows={rows} ours={ours} />}
          </>
        )}
      </div>
    </main>
  )
}

/** "All posts" / "Made in OpenCatt" (OP-112): only what is shown changes, never what is read. */
function FilterSwitch({
  value,
  onChange
}: {
  value: StatsFilter
  onChange(filter: StatsFilter): void
}): React.JSX.Element {
  return (
    <Segmented role="group" aria-label="Which posts" className="ml-[-2px]">
      <SegmentedItem aria-pressed={value === 'all'} onClick={() => onChange('all')}>
        All posts
      </SegmentedItem>
      <SegmentedItem aria-pressed={value === 'opencatt'} onClick={() => onChange('opencatt')}>
        Made in OpenCatt
      </SegmentedItem>
    </Segmented>
  )
}

function NoneOurs({ onShowAll }: { onShowAll(): void }): React.JSX.Element {
  return (
    <section
      aria-label="No OpenCatt posts"
      className="flex min-h-[320px] flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-ds-border"
    >
      <span className="grid size-10 place-items-center rounded-[10px] border border-ds-border text-ds-text-2">
        <Filter size={16} aria-hidden="true" />
      </span>
      <p className="m-0 text-[14px] text-ds-text-2">
        None of your last 100 posts were made in OpenCatt.
      </p>
      <Button type="button" onClick={onShowAll}>
        Show all posts
      </Button>
    </section>
  )
}

function PricingLink({
  href,
  className = ''
}: {
  href: string
  className?: string
}): React.JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-0.5 text-ds-accent-text no-underline ${className}`}
    >
      X&apos;s pricing
      <ArrowUpRight size={12} aria-hidden="true" />
    </a>
  )
}

function Heading({
  id,
  title,
  sub,
  aside
}: {
  id: string
  title: string
  sub: string
  aside?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 id={id} className="m-0 text-[15px] font-medium">
          {title}
        </h2>
        <span className="text-[12px] text-ds-text-3">{sub}</span>
      </div>
      {aside}
    </div>
  )
}

/** The big views number with its change, and the tiles beside it. */
function Summary({
  stats,
  rows,
  since,
  lastAt
}: {
  stats: ReturnType<typeof useStats>
  /** The posts the switch shows; Spent on X always counts everything X charged. */
  rows: PostStatsRow[]
  since: ReturnType<typeof sinceLast>
  lastAt: string | undefined
}): React.JSX.Element {
  const t = stats.totals
  const has = stats.loaded && !!stats.lastSync && !!t
  const ours = stats.filter === 'opencatt'
  const shown = sumStats(rows)
  // Nothing of OpenCatt's among the posts read: the zeros stay quiet (OP-112 frame 3).
  const muted = ours && rows.length === 0
  const change = (key: keyof PostStats): string =>
    since
      ? `+${number.format(Math.max(0, since.delta[key]))} since ${format(new Date(since.at), 'd MMM')}`
      : 'last 100 posts'
  const spent = t ? t.postingCost + t.readsCost : 0

  return (
    <section aria-label="Totals" className="flex flex-wrap items-stretch gap-x-6 gap-y-5">
      <div className="flex min-w-[220px] flex-1 basis-[220px] flex-col gap-1 whitespace-nowrap">
        <span className="text-[13px] text-ds-text-2">
          Views{' '}
          <span className="text-ds-text-3">
            {ours ? 'OpenCatt posts in the last 100' : 'last 100 posts'}
          </span>
        </span>
        <span
          className={`font-mono text-[40px] font-medium tracking-[-1.2px] ${muted ? 'text-ds-text-3' : ''}`}
          data-testid="views-total"
        >
          {has ? number.format(shown.impressions) : '—'}
        </span>
        {has &&
          (since ? (
            <span className="flex items-center gap-1.5 text-[12px] text-ds-text-3">
              {since.delta.impressions > 0 && <TrendingUp size={12} aria-hidden="true" />}
              <span className="font-mono font-medium text-ds-text">
                +{number.format(Math.max(0, since.delta.impressions))}
              </span>
              since {format(new Date(since.at), 'd MMM')}
            </span>
          ) : (
            lastAt && (
              <span className="text-[12px] text-ds-text-3">
                First refresh · {format(new Date(lastAt), 'd MMM HH:mm')}
              </span>
            )
          ))}
      </div>
      <div className="flex min-w-0 flex-[2_1_560px] flex-wrap gap-y-4">
        <Tile
          label="Likes"
          value={has ? number.format(shown.likes) : '—'}
          muted={muted}
          sub={has ? change('likes') : ''}
        />
        <Tile
          label="Reposts"
          value={has ? number.format(shown.reposts) : '—'}
          muted={muted}
          sub={has ? change('reposts') : ''}
        />
        <Tile
          label="Replies"
          value={has ? number.format(shown.replies) : '—'}
          muted={muted}
          sub={has ? change('replies') : ''}
        />
        <Tile
          label="Spent on X"
          value={has ? dollars(spent) : '—'}
          estimated={has}
          sub={
            !has
              ? ''
              : ours
                ? `${dollars(costOf(rows))} on these posts`
                : `posts ${dollars(t.postingCost)} · reads ${dollars(t.readsCost)}`
          }
        />
      </div>
    </section>
  )
}

function Tile({
  label,
  value,
  sub,
  estimated = false,
  muted = false
}: {
  label: string
  value: string
  sub: string
  estimated?: boolean
  muted?: boolean
}): React.JSX.Element {
  return (
    <div className="flex min-w-[104px] flex-1 flex-col gap-1.5 border-l border-ds-border px-4 whitespace-nowrap">
      <span className="text-[13px] text-ds-text-2">{label}</span>
      <span className="flex items-baseline gap-1.5">
        <span
          className={`font-mono text-[20px] font-medium tracking-[-0.4px] ${muted ? 'text-ds-text-3' : ''}`}
        >
          {value}
        </span>
        {estimated && <span className="text-[11px] text-ds-text-3 italic">est.</span>}
      </span>
      <span className="text-[11px] text-ds-text-3">{sub}</span>
    </div>
  )
}

/** Views by post and engagement rate, for the last 14 posts. */
function PerPost({ rows, ours }: { rows: PostStatsRow[]; ours: boolean }): React.JSX.Element {
  const recent = recentPosts(rows)
  const avg = averageRate(recent)
  const first = recent[0] ? format(new Date(recent[0].postedAt), 'd MMM') : ''
  const lastPost = recent[recent.length - 1]
  const last = lastPost ? format(new Date(lastPost.postedAt), 'd MMM') : ''
  const peak = Math.max(0, ...recent.map((r) => r.stats.impressions))
  const empty = (
    <div className="grid h-[140px] place-items-center text-[13px] text-ds-text-3">
      No posts read yet
    </div>
  )
  return (
    <section aria-label="Per post" className="grid grid-cols-1 gap-10 @min-[600px]:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3">
        <Heading
          id="by-post"
          title="Views by post"
          sub={`Last 14 ${ours ? 'OpenCatt ' : ''}posts, oldest to newest`}
        />
        {recent.length === 0 ? (
          empty
        ) : (
          <BarChart
            label="Views of the last 14 posts"
            bars={recent.map((r) => ({
              value: r.stats.impressions,
              strong: r.stats.impressions === peak,
              title: `${number.format(r.stats.impressions)} views · ${r.text.slice(0, 60)}`
            }))}
            firstLabel={first}
            lastLabel={last}
            peak
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <Heading
          id="engagement"
          title="Engagement rate"
          sub="Likes, reposts, replies, quotes and bookmarks ÷ views"
        />
        {recent.length === 0 ? (
          empty
        ) : (
          <BarChart
            label="Engagement rate of the last 14 posts"
            bars={recent.map((r) => {
              const rate = engagementRate(r.stats)
              return {
                value: rate,
                strong: rate >= avg,
                title: `${percent(rate)} · ${r.text.slice(0, 60)}`
              }
            })}
            firstLabel={first}
            lastLabel={last}
            formatValue={percent}
            average={avg}
          />
        )}
      </div>
    </section>
  )
}

/** Every post read, most views first, with what it has cost on X. */
function Posts({ rows, ours }: { rows: PostStatsRow[]; ours: boolean }): React.JSX.Element {
  const list = topPosts(rows, rows.length)
  const max = Math.max(1, ...list.map((r) => r.stats.impressions))
  return (
    // The row answers to the list's own width, so it fits with the chat panel open (OP-114): the
    // bar goes first, then likes and replies, then the cost; text and views always stay.
    <section aria-labelledby="top-posts" className="@container flex min-w-0 flex-col">
      <div className="flex items-baseline gap-2 pb-3">
        <h2 id="top-posts" className="m-0 text-[15px] font-medium">
          Top posts
        </h2>
        <span className="text-[12px] text-ds-text-3">
          by views · {ours ? 'OpenCatt posts in the last 100' : 'last 100 posts'}
        </span>
      </div>
      <ol className="m-0 flex list-none flex-col divide-y divide-ds-border border-t border-ds-border p-0">
        {list.map((row, i) => {
          const cost = (row.postingCost ?? 0) + row.readsCost
          return (
            <li key={row.remoteId} className="flex items-center gap-5 py-3" data-testid="top-post">
              <span className="w-5 shrink-0 font-mono text-[12px] text-ds-text-3">{i + 1}</span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-[14px]">{row.text}</span>
                <span className="text-[12px] text-ds-text-3">
                  {format(new Date(row.postedAt), 'd MMM · HH:mm')}
                  {row.postId === null && ' · posted outside OpenCatt'}
                </span>
              </span>
              <span
                className="hidden h-[6px] max-w-[240px] min-w-[80px] flex-[0_1_240px] rounded-full bg-ds-raised @min-[720px]:block"
                data-testid="top-post-bar"
              >
                <span
                  className="block h-full rounded-full bg-ds-accent"
                  style={{
                    width: `${(row.stats.impressions / max) * 100}%`,
                    opacity: 0.45 + 0.55 * (row.stats.impressions / max)
                  }}
                />
              </span>
              <span className="w-[80px] shrink-0 text-right font-mono text-[15px] font-medium">
                {number.format(row.stats.impressions)}
              </span>
              <span
                className="hidden w-[110px] shrink-0 items-center justify-end gap-3 text-[12px] text-ds-text-2 @min-[560px]:flex"
                data-testid="top-post-reactions"
              >
                <span className="flex items-center gap-1" title="Likes">
                  <Heart size={12} aria-hidden="true" />
                  {number.format(row.stats.likes)}
                </span>
                <span className="flex items-center gap-1" title="Replies">
                  <MessageCircle size={12} aria-hidden="true" />
                  {number.format(row.stats.replies)}
                </span>
              </span>
              <span
                className="hidden w-[90px] shrink-0 text-right font-mono text-[12px] text-ds-text-2 @min-[420px]:block"
                data-testid="top-post-cost"
                title={
                  row.postId === null
                    ? 'Reading its stats; it was posted outside OpenCatt'
                    : row.postingEstimated
                      ? 'Posting (estimated) plus reading its stats'
                      : 'Posting plus reading its stats'
                }
              >
                {dollars(cost)}{' '}
                <span className="font-sans text-[11px] text-ds-text-3 italic">est.</span>
              </span>
            </li>
          )
        })}
      </ol>
      <p className="m-0 flex items-center gap-1 pt-3 text-[11px] text-ds-text-3">
        <History size={11} aria-hidden="true" />
        Posts past your last 100 keep the numbers from the refresh that last read them.
      </p>
    </section>
  )
}
