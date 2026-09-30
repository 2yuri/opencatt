import { useEffect, useId, useRef, useState } from 'react'
import { format } from 'date-fns'
import { niceMax, shortNumber } from './derive'

const number = new Intl.NumberFormat('en-US')

/**
 * The element's width, followed as the window resizes; a stand-in until it is measured. The box
 * has contain: inline-size, so an SVG drawn at the old width never holds it open when the window
 * or the chat panel shrinks (OP-114).
 */
function useWidth(fallback = 800): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

const AXIS = 'font-mono text-[10px] fill-ds-text-3'
const LEFT = 44
const RIGHT = 88

export interface LinePoint {
  at: Date
  value: number
}

/**
 * Views over time (OP-110): one dot per refresh, spaced by when it ran, with the area under the
 * line in the accent. Hovering a refresh shows its time and total. One refresh is a single dot
 * with a note to refresh again later.
 */
export function LineChart({
  points,
  label = 'views'
}: {
  points: LinePoint[]
  label?: string
}): React.JSX.Element {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const gradient = useId()
  const height = 230
  const top = 16
  const bottom = 30
  const plotW = Math.max(40, width - LEFT - RIGHT)
  const plotH = height - top - bottom
  const max = niceMax(Math.max(...points.map((p) => p.value), 0))
  const first = points[0]?.at.getTime() ?? 0
  const last = points[points.length - 1]?.at.getTime() ?? 0
  const span = Math.max(1, last - first)
  const single = points.length === 1
  const x = (at: Date): number =>
    single ? LEFT + plotW : LEFT + ((at.getTime() - first) / span) * plotW
  const y = (v: number): number => top + plotH - (v / max) * plotH
  const coords = points.map((p) => ({ x: x(p.at), y: y(p.value), p }))
  const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x},${c.y}`).join(' ')
  const area = coords.length
    ? `${line} L${coords[coords.length - 1]!.x},${top + plotH} L${coords[0]!.x},${top + plotH} Z`
    : ''
  const ticks = single ? [] : Array.from({ length: 5 }, (_, i) => new Date(first + (span * i) / 4))
  const end = coords[coords.length - 1]
  const hovered = hover === null ? null : coords[hover]

  return (
    <div ref={ref} className="relative w-full [contain:inline-size]">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Total ${label} at each refresh`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (coords.length < 2) return
          const box = e.currentTarget.getBoundingClientRect()
          const mx = e.clientX - box.left
          let best = 0
          coords.forEach((c, i) => {
            if (Math.abs(c.x - mx) < Math.abs(coords[best]!.x - mx)) best = i
          })
          setHover(best)
        }}
      >
        <defs>
          <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--ds-accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--ds-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => {
          const v = (max / 3) * i
          return (
            <g key={i}>
              <line x1={LEFT} x2={LEFT + plotW} y1={y(v)} y2={y(v)} stroke="var(--ds-border)" />
              <text x={LEFT - 12} y={y(v) + 3} textAnchor="end" className={AXIS}>
                {shortNumber(v)}
              </text>
            </g>
          )
        })}
        {!single && coords.length > 1 && (
          <>
            <path d={area} fill={`url(#${gradient})`} />
            <path d={line} fill="none" stroke="var(--ds-accent)" strokeWidth={2} />
          </>
        )}
        {hovered && (
          <line
            x1={hovered.x}
            x2={hovered.x}
            y1={top}
            y2={top + plotH}
            stroke="var(--ds-border-strong)"
          />
        )}
        {coords.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={i === hover ? 5 : 3.5}
            fill="var(--ds-accent)"
            stroke="var(--ds-surface)"
            strokeWidth={1.5}
          />
        ))}
        {end && (
          <text
            x={end.x + 12}
            y={end.y + 4}
            className="font-mono text-[12px] font-medium fill-ds-text"
          >
            {number.format(end.p.value)}
          </text>
        )}
        {ticks.map((t, i) => (
          <text
            key={i}
            x={LEFT + (plotW * i) / 4}
            y={height - 8}
            textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
            className={AXIS}
          >
            {format(t, 'd MMM')}
          </text>
        ))}
        {single && end && (
          <text x={LEFT + plotW} y={height - 8} textAnchor="end" className={AXIS}>
            {format(end.p.at, 'd MMM HH:mm')}
          </text>
        )}
      </svg>
      {single && (
        <p className="pointer-events-none absolute inset-x-0 top-[40%] m-0 text-center text-[13px] text-ds-text-2">
          Refresh again later to see {label} grow
        </p>
      )}
      {hovered && (
        <div
          className="pointer-events-none absolute flex flex-col gap-[3px] rounded-lg border border-ds-border-strong bg-ds-raised px-3 py-2 shadow-[0_4px_12px_#00000066]"
          style={{
            left: Math.min(Math.max(hovered.x - 140, 0), width - 200),
            top: hovered.y + 40
          }}
          role="status"
        >
          <span className="text-[11px] text-ds-text-3">
            Refresh · {format(hovered.p.at, 'd MMM HH:mm')}
          </span>
          <span className="text-[13px] text-ds-text-2">
            <span className="font-mono font-medium text-ds-text">
              {number.format(hovered.p.value)}
            </span>{' '}
            {label}
          </span>
        </div>
      )}
    </div>
  )
}

export interface Bar {
  value: number
  /** Drawn in the full accent; the rest are dimmed. */
  strong: boolean
  title: string
}

/**
 * Bars for the last posts (OP-110), oldest to newest, with the first and last post's dates below.
 * `average` draws a dashed line with its value; `peak` writes the tallest bar's value on it.
 */
export function BarChart({
  bars,
  firstLabel,
  lastLabel,
  formatValue = shortNumber,
  average,
  peak = false,
  label
}: {
  bars: Bar[]
  firstLabel: string
  lastLabel: string
  formatValue?: (v: number) => string
  average?: number
  peak?: boolean
  label: string
}): React.JSX.Element {
  const [ref, width] = useWidth(500)
  const height = 176
  const top = 18
  const bottom = 26
  const right = average === undefined ? 0 : 80
  const plotW = Math.max(40, width - LEFT - right)
  const plotH = height - top - bottom
  const max = niceMax(Math.max(...bars.map((b) => b.value), average ?? 0))
  const y = (v: number): number => top + plotH - (v / max) * plotH
  const slot = plotW / Math.max(1, bars.length)
  const barW = Math.max(4, slot * 0.7)
  const tallest = bars.reduce((best, b, i) => (b.value > (bars[best]?.value ?? -1) ? i : best), 0)

  return (
    <div ref={ref} className="w-full [contain:inline-size]">
      <svg width={width} height={height} role="img" aria-label={label}>
        {[0, 1, 2, 3].map((i) => {
          const v = (max / 3) * i
          return (
            <g key={i}>
              <line x1={LEFT} x2={LEFT + plotW} y1={y(v)} y2={y(v)} stroke="var(--ds-border)" />
              <text x={LEFT - 12} y={y(v) + 3} textAnchor="end" className={AXIS}>
                {formatValue(v)}
              </text>
            </g>
          )
        })}
        {bars.map((b, i) => (
          <rect
            key={i}
            x={LEFT + slot * i + (slot - barW) / 2}
            y={y(b.value)}
            width={barW}
            height={Math.max(0, top + plotH - y(b.value))}
            rx={2}
            fill="var(--ds-accent)"
            fillOpacity={b.strong ? 1 : 0.4}
          >
            <title>{b.title}</title>
          </rect>
        ))}
        {peak && bars[tallest] && (
          <text
            x={LEFT + slot * tallest + slot / 2}
            y={y(bars[tallest]!.value) - 5}
            textAnchor="middle"
            className="font-mono text-[10px] font-medium fill-ds-text-2"
          >
            {number.format(bars[tallest]!.value)}
          </text>
        )}
        {average !== undefined && (
          <>
            <line
              x1={LEFT}
              x2={LEFT + plotW}
              y1={y(average)}
              y2={y(average)}
              stroke="var(--ds-text-2)"
              strokeDasharray="4 4"
            />
            <text
              x={LEFT + plotW + 10}
              y={y(average) + 3}
              className="font-mono text-[10px] font-medium fill-ds-text-2"
            >
              avg {formatValue(average)}
            </text>
          </>
        )}
        <text x={LEFT} y={height - 6} className={AXIS}>
          {firstLabel}
        </text>
        <text x={LEFT + plotW} y={height - 6} textAnchor="end" className={AXIS}>
          {lastLabel}
        </text>
      </svg>
    </div>
  )
}
