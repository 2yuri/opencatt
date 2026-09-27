import { useEffect, useRef } from 'react'
import { addDays, format } from 'date-fns'
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import type { Post } from '@shared/api'
import { parseLocalDate, toLocalDate } from '../calendar/grid'
import { useEditor } from '../editor/editorContext'
import { NewPostButton } from '../editor/NewPostButton'
import { TOOLBAR_COMPACT_BELOW, useElementWidth } from '../shell/layout'
import { ignoreShortcut } from '../shortcuts'
import { PostCard } from './PostCard'
import { splitColumns } from './columns'
import { usePostsForDay } from './usePostsForDay'
import { buttonClass } from '../ui'

/** One day as a board: what is still to go out, and what already went out. */
export function DayBoardScreen(): React.JSX.Element {
  const { date } = useParams()
  const day = parseLocalDate(date)
  if (!day || !date) return <Navigate to="/" replace />
  return <DayBoard date={date} day={day} />
}

function DayBoard({ date, day }: { date: string; day: Date }): React.JSX.Element {
  const navigate = useNavigate()
  const editor = useEditor()
  const { posts, error } = usePostsForDay(date)
  const columns = posts ? splitColumns(posts) : null
  const previous = toLocalDate(addDays(day, -1))
  const next = toLocalDate(addDays(day, 1))
  // On a narrow main card New post becomes an icon, so the toolbar stays on one line (OP-58).
  const screenRef = useRef<HTMLElement>(null)
  const compact = useElementWidth(screenRef) < TOOLBAR_COMPACT_BELOW

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (ignoreShortcut(event)) return
      if (event.key === 'ArrowLeft') navigate(`/day/${previous}`)
      else if (event.key === 'ArrowRight') navigate(`/day/${next}`)
      else if (event.key === 'Escape') navigate(`/?view=month&date=${date}`)
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, previous, next, date])

  return (
    <main ref={screenRef} className="flex h-full min-h-0 flex-col">
      <header
        className={`flex h-[60px] shrink-0 items-center overflow-hidden border-b border-ds-border ${compact ? 'gap-2 px-4' : 'gap-2.5 px-5'}`}
      >
        <Link
          className={buttonClass('secondary', 'md', 'shrink-0 no-underline')}
          to={`/?view=month&date=${date}`}
        >
          <ChevronLeft size={14} aria-hidden="true" />
          Calendar
        </Link>
        <h1 className="m-0 min-w-0 truncate text-[20px] font-semibold tracking-[-0.4px] whitespace-nowrap">
          {format(day, 'EEEE')}{' '}
          <span className="font-normal text-ds-text-3">{format(day, 'd MMMM yyyy')}</span>
        </h1>
        <nav className="flex shrink-0 items-center gap-1.5" aria-label="Day navigation">
          <Link className="icon-btn" to={`/day/${previous}`}>
            <ChevronLeft size={16} aria-hidden="true" />
            <span className="sr-only">Previous day</span>
          </Link>
          <Link className="icon-btn" to={`/day/${next}`}>
            <ChevronRight size={16} aria-hidden="true" />
            <span className="sr-only">Next day</span>
          </Link>
        </nav>
        <span className="min-w-0 flex-1" />
        <NewPostButton compact={compact} onClick={() => editor.openNew(date)} />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5">
        {error && <p className="m-0 text-[13px] text-ds-red">Could not load posts: {error}</p>}

        {columns && columns.pending.length > 0 && (
          <p className="m-0 flex items-center gap-2 rounded-[10px] bg-ds-amber-2 px-3.5 py-2.5 text-[13px] text-ds-amber">
            <span className="size-1.5 rounded-full bg-ds-amber" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              {columns.pending.length === 1
                ? '1 post for this day is waiting for your approval.'
                : `${columns.pending.length} posts for this day are waiting for your approval.`}
            </span>
            <Link
              className="shrink-0 font-semibold whitespace-nowrap text-ds-amber no-underline"
              to="/approvals"
            >
              Review in Approvals
            </Link>
            <ArrowRight size={14} className="shrink-0" aria-hidden="true" />
          </p>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-[repeat(2,minmax(0,1fr))] gap-4">
          <Column
            title="Scheduled"
            posts={columns?.scheduled}
            empty="Nothing scheduled for this day."
          />
          <Column title="Posted" posts={columns?.posted} empty="Nothing posted on this day yet." />
        </div>
      </div>
    </main>
  )
}

function Column({
  title,
  posts,
  empty
}: {
  title: string
  posts: Post[] | undefined
  empty: string
}): React.JSX.Element {
  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-2" aria-label={title}>
      <h2 className="m-0 flex items-center gap-2 px-0.5 pb-1 text-[11px] font-semibold tracking-[0.8px] text-ds-text-3 uppercase">
        {title}
        {posts && <span>{posts.length}</span>}
      </h2>
      {posts?.length === 0 && (
        <p className="m-0 rounded-xl border border-dashed border-ds-border px-4 py-6 text-center text-[13px] text-ds-text-3">
          {empty}
        </p>
      )}
      {posts?.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </section>
  )
}
