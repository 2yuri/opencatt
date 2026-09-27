import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { isSameDay, isSameMonth } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayCell } from './DayCell'
import {
  gridDays,
  gridRange,
  parseLocalDate,
  shiftAnchor,
  toLocalDate,
  viewTitle,
  weekdayLabels,
  type CalendarView
} from './grid'
import { useDayPosts } from './useDayPosts'
import { usePending } from './usePending'
import { useWeekStart } from './useWeekStart'
import { useEditor } from '../editor/editorContext'
import { NewPostButton } from '../editor/NewPostButton'
import { TOOLBAR_COMPACT_BELOW, TOOLBAR_TIGHT_BELOW, useElementWidth } from '../shell/layout'
import { ignoreShortcut } from '../shortcuts'
import { Button, Segmented, SegmentedItem } from '../ui'

/** The app's main screen. View and anchor date live in the URL, so back and forward work. */
export function CalendarScreen(): React.JSX.Element {
  const navigate = useNavigate()
  const editor = useEditor()
  const [params, setParams] = useSearchParams()

  const view: CalendarView = params.get('view') === 'week' ? 'week' : 'month'
  const dateParam = params.get('date')
  const anchor = useMemo(() => parseLocalDate(dateParam) ?? new Date(), [dateParam])
  const today = new Date()

  const { weekStartsOn } = useWeekStart()
  const days = useMemo(() => gridDays(view, anchor, weekStartsOn), [view, anchor, weekStartsOn])
  const { from, to } = gridRange(view, anchor, weekStartsOn)
  const { posts, error } = useDayPosts(from, to)
  const pending = usePending()
  // The toolbar stays on one line down to the narrowest main card (OP-58).
  const screenRef = useRef<HTMLElement>(null)
  const width = useElementWidth(screenRef)
  const compact = width < TOOLBAR_COMPACT_BELOW
  const tight = width < TOOLBAR_TIGHT_BELOW

  const show = useCallback(
    (nextView: CalendarView, nextAnchor: Date) => {
      setParams({ view: nextView, date: toLocalDate(nextAnchor) })
    },
    [setParams]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (ignoreShortcut(event)) return
      if (event.key === 'ArrowLeft') show(view, shiftAnchor(view, anchor, -1))
      else if (event.key === 'ArrowRight') show(view, shiftAnchor(view, anchor, 1))
      else if (event.key === 't' || event.key === 'T') show(view, new Date())
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [show, view, anchor])

  const title = viewTitle(view, anchor, weekStartsOn, tight)
  const year = /\s(\d{4})$/.exec(title)?.[1]

  return (
    <main
      ref={screenRef}
      className="flex h-full min-h-0 flex-col"
      data-toolbar={tight ? 'tight' : compact ? 'compact' : 'full'}
    >
      <header
        className={`flex h-[60px] shrink-0 items-center overflow-hidden border-b border-ds-border ${compact ? 'gap-2 px-4' : 'gap-2.5 px-5'}`}
      >
        <h1 className="m-0 min-w-0 truncate text-[20px] font-semibold tracking-[-0.4px] whitespace-nowrap">
          {year ? title.slice(0, -year.length - 1) : title}
          {year && (
            <>
              {' '}
              <span className="font-normal text-ds-text-3">{year}</span>
            </>
          )}
        </h1>
        {pending && pending.count > 0 && pending.first && (
          <button
            type="button"
            className="flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-[13px] border-0 bg-ds-amber-2 px-2.5 text-[12px] font-medium whitespace-nowrap text-ds-amber"
            onClick={() => navigate('/approvals')}
            title="Open Approvals"
            aria-label={`${pending.count} to approve`}
          >
            <span className="size-1.5 rounded-full bg-ds-amber" aria-hidden="true" />
            {compact ? pending.count : `${pending.count} to approve`}
          </button>
        )}
        <span className="min-w-0 flex-1" />
        <nav className="flex shrink-0 items-center gap-1.5" aria-label="Calendar navigation">
          <button
            type="button"
            className="icon-btn"
            onClick={() => show(view, shiftAnchor(view, anchor, -1))}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            <span className="sr-only">Previous {view}</span>
          </button>
          <Button type="button" variant="secondary" onClick={() => show(view, new Date())}>
            Today
          </Button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => show(view, shiftAnchor(view, anchor, 1))}
          >
            <ChevronRight size={16} aria-hidden="true" />
            <span className="sr-only">Next {view}</span>
          </button>
        </nav>
        <Segmented role="group" aria-label="View" className="shrink-0">
          {(['month', 'week'] as const).map((option) => (
            <SegmentedItem
              key={option}
              aria-pressed={view === option}
              onClick={() => show(option, anchor)}
            >
              {option === 'month' ? 'Month' : 'Week'}
            </SegmentedItem>
          ))}
        </Segmented>
        <NewPostButton compact={compact} onClick={() => editor.openNew()} />
      </header>

      {error && (
        <p className="m-0 px-5 py-2 text-[12px] text-ds-red">Could not load posts: {error}</p>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className="grid h-[34px] shrink-0 grid-cols-[repeat(7,minmax(0,1fr))] border-b border-ds-border"
          aria-hidden="true"
        >
          {weekdayLabels(weekStartsOn).map((label) => (
            <div
              key={label}
              className="min-w-0 truncate px-3 text-[11px] leading-[34px] font-medium tracking-[0.6px] text-ds-text-3 uppercase"
            >
              {label}
            </div>
          ))}
        </div>
        <div
          className={`grid min-h-0 flex-1 grid-cols-[repeat(7,minmax(0,1fr))] ${view === 'month' ? 'grid-rows-6' : 'grid-rows-1'} [&>*]:border-ds-border [&>*:not(:nth-child(7n))]:border-r ${view === 'month' ? '[&>*:nth-child(-n+35)]:border-b' : ''}`}
          data-testid={`calendar-${view}`}
        >
          {days.map((day) => {
            const date = toLocalDate(day)
            return (
              <DayCell
                key={date}
                day={day}
                posts={posts[date] ?? []}
                outside={view === 'month' && !isSameMonth(day, anchor)}
                today={isSameDay(day, today)}
                max={view === 'month' ? 3 : 12}
                onOpenDay={() => navigate(`/day/${date}`)}
                onOpenPost={(post) => editor.openPost(post)}
              />
            )
          })}
        </div>
      </div>
    </main>
  )
}
