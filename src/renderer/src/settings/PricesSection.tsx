import { useEffect, useId, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { ArrowUpRight } from 'lucide-react'
import type { XPrices } from '@shared/api'
import { BOX, HEADING, LINK, SECTION, messageOf } from './common'
import { Row } from './parts'

type Field = 'post' | 'postWithUrl' | 'ownedRead'

const ROWS: { field: Field; title: string; sub: string }[] = [
  { field: 'post', title: 'Post', sub: 'Each post OpenCatt sends for you.' },
  {
    field: 'postWithUrl',
    title: 'Post with a link',
    sub: 'Posts that contain a URL cost more on X.'
  },
  {
    field: 'ownedRead',
    title: 'Read a post',
    sub: "Reading one post's stats. A refresh reads 100."
  }
]

/**
 * X's prices (OP-110, Pencil "OP-110 · 5"): what the Dashboard's estimates use. They start as X's
 * own, checked on the date shown, and can be edited here when X changes them; past spend keeps
 * the price it was charged at.
 */
export function PricesSection(): React.JSX.Element {
  const headingId = useId()
  const [prices, setPrices] = useState<XPrices | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const load = (): void =>
      void window.opencat.stats.prices
        .get()
        .then((p) => live && setPrices(p))
        .catch((err: unknown) => live && setError(messageOf(err)))
    load()
    const stop = window.opencat.stats.onChanged(load)
    return () => {
      live = false
      stop()
    }
  }, [])

  const save = (field: Field, text: string): void => {
    const value = Number(text)
    setError(null)
    window.opencat.stats.prices
      .set({ [field]: text.trim() === '' ? Number.NaN : value })
      .then(setPrices)
      .catch((err: unknown) => setError(messageOf(err)))
  }

  return (
    <section className={SECTION} aria-labelledby={headingId}>
      <div className="flex items-center gap-2">
        <h2 id={headingId} className={`${HEADING} flex-1`}>
          X prices
        </h2>
        {prices?.edited && (
          <button
            type="button"
            className={LINK}
            onClick={() => {
              setError(null)
              window.opencat.stats.prices
                .reset()
                .then(setPrices)
                .catch((err: unknown) => setError(messageOf(err)))
            }}
          >
            Reset to defaults
          </button>
        )}
      </div>
      <p className="m-0 text-[12px] text-ds-text-3">
        Used to estimate what OpenCatt costs you on X.
        {prices && ` Prices as of ${format(parseISO(prices.asOf), 'd MMM yyyy')}.`}{' '}
        <a
          href={prices?.sourceUrl ?? 'https://docs.x.com/x-api/getting-started/pricing'}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-ds-accent-text no-underline"
        >
          X&apos;s pricing
          <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      </p>
      <div className={BOX}>
        {ROWS.map((row, i) => (
          <PriceRow
            key={`${row.field}-${prices?.[row.field] ?? ''}`}
            {...row}
            value={prices?.[row.field]}
            error={i === ROWS.length - 1 ? error : null}
            onSave={(text) => save(row.field, text)}
          />
        ))}
      </div>
    </section>
  )
}

function PriceRow({
  field,
  title,
  sub,
  value,
  error,
  onSave
}: {
  field: Field
  title: string
  sub: string
  value: number | undefined
  error: string | null
  onSave: (text: string) => void
}): React.JSX.Element {
  const inputId = useId()
  const [text, setText] = useState(value === undefined ? '' : value.toFixed(3))
  return (
    <Row
      title={title}
      titleFor={inputId}
      sub={sub}
      error={error}
      control={
        <span className="flex h-[36px] w-[140px] items-center gap-2 rounded-lg border border-ds-border-strong bg-ds-surface px-3">
          <span className="font-mono text-[13px] text-ds-text-3" aria-hidden="true">
            $
          </span>
          <input
            id={inputId}
            inputMode="decimal"
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-right font-mono text-[13px] font-medium text-ds-text outline-none"
            value={text}
            data-field={field}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              if (value === undefined || Number(text) !== value) onSave(text)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
        </span>
      }
    />
  )
}
