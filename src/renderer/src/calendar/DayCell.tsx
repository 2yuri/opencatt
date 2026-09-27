import { useRef } from 'react'
import { format } from 'date-fns'
import type { Post, PostStatus } from '@shared/api'
import { useElementSize } from '../shell/layout'
import { chipsThatFit } from './grid'

interface DayCellProps {
  day: Date
  posts: Post[]
  outside: boolean
  today: boolean
  /** The most chips before "+N more": 3 in the month grid, more in the week. Fewer when the
   * cell is too short for them (OP-58). */
  max: number
  onOpenDay: () => void
  onOpenPost: (post: Post) => void
}

/** Chip colours per status, from the Pencil PostChip variants (design v2). */
const CHIP: Record<PostStatus, { chip: string; bar: string; time: string }> = {
  pending_approval: { chip: 'bg-ds-amber-2', bar: 'bg-ds-amber', time: 'text-ds-amber' },
  scheduled: { chip: 'bg-ds-blue-2', bar: 'bg-ds-blue', time: 'text-ds-blue' },
  posting: { chip: 'bg-ds-blue-2', bar: 'bg-ds-blue', time: 'text-ds-blue' },
  posted: { chip: 'bg-ds-green-2', bar: 'bg-ds-green', time: 'text-ds-green' },
  failed: { chip: 'bg-ds-red-2', bar: 'bg-ds-red', time: 'text-ds-red' },
  rejected: { chip: 'bg-ds-raised', bar: 'bg-ds-text-3', time: 'text-ds-text-3' }
}

const LABEL: Record<PostStatus, string> = {
  pending_approval: 'to approve',
  scheduled: 'scheduled',
  posting: 'scheduled',
  posted: 'posted',
  failed: 'failed',
  rejected: 'rejected'
}

/** Below this cell width the chips tighten their padding. */
const NARROW_CELL = 100

/** One day of the calendar: its number and a chip per post, earliest first. */
export function DayCell({
  day,
  posts,
  outside,
  today,
  max,
  onOpenDay,
  onOpenPost
}: DayCellProps): React.JSX.Element {
  const cellRef = useRef<HTMLDivElement>(null)
  const size = useElementSize(cellRef)
  const shown = posts.slice(0, chipsThatFit(size.height, posts.length, max))
  const narrow = size.width < NARROW_CELL
  const more = posts.length - shown.length

  // "Tuesday 29 September 2026, 3 to approve, 1 scheduled", in the order of LABEL.
  const tally = new Map<string, number>()
  for (const post of posts) tally.set(LABEL[post.status], (tally.get(LABEL[post.status]) ?? 0) + 1)
  const parts = [format(day, 'EEEE d MMMM yyyy')]
  for (const label of new Set(Object.values(LABEL))) {
    const n = tally.get(label)
    if (n) parts.push(`${n} ${label}`)
  }

  return (
    <div
      ref={cellRef}
      className={`relative flex min-h-0 min-w-0 flex-col gap-1 overflow-hidden px-2 pt-1.5 pb-1 ${today ? 'bg-ds-raised' : ''}`}
      data-testid="day-cell"
      data-outside={outside || undefined}
    >
      {/* The whole cell opens the day; the chips sit above it and open their post. */}
      <button
        type="button"
        className="absolute inset-0 cursor-pointer border-0 bg-transparent p-0 hover:bg-ds-raised/40"
        onClick={onOpenDay}
        aria-label={parts.join(', ')}
        aria-current={today ? 'date' : undefined}
      />
      <span className="pointer-events-none relative flex h-[22px] shrink-0 items-center px-0.5">
        {today ? (
          <span className="grid size-[22px] place-items-center rounded-full bg-ds-accent text-[12px] font-semibold text-white">
            {format(day, 'd')}
          </span>
        ) : (
          <span
            className={`text-[12px] font-medium ${outside ? 'text-ds-text-3 opacity-50' : 'text-ds-text-2'}`}
          >
            {format(day, 'd')}
          </span>
        )}
      </span>
      {shown.map((post) => {
        const c = CHIP[post.status]
        return (
          <button
            key={post.id}
            type="button"
            className={`relative flex h-6 w-full min-w-0 shrink-0 cursor-pointer items-center overflow-hidden rounded-md border-0 text-left ${narrow ? 'gap-1 px-1.5' : 'gap-1.5 px-2'} ${c.chip} ${post.status === 'rejected' ? 'opacity-60' : ''}`}
            onClick={() => onOpenPost(post)}
            title={post.text}
            data-testid="post-chip"
            data-status={post.status}
          >
            <span className={`h-3 w-0.5 shrink-0 rounded-[1px] ${c.bar}`} aria-hidden="true" />
            <span className={`shrink-0 font-mono text-[11px] font-medium ${c.time}`}>
              {format(new Date(post.scheduledAt), 'HH:mm')}
            </span>
            <span
              className={`min-w-0 truncate text-[11px] text-ds-text ${post.status === 'rejected' ? 'line-through' : ''}`}
            >
              {post.text}
            </span>
          </button>
        )
      })}
      {more > 0 && (
        <span className="pointer-events-none relative shrink-0 truncate px-0.5 text-[11px] leading-[14px] font-medium text-ds-text-3">
          +{more} more
        </span>
      )}
    </div>
  )
}
