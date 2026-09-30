import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'

import type { PostMedia } from '@shared/api'
import type { DraftPart } from './draft'
import { measureText } from './postText'
import { Button } from '../ui'
import { ImportErrorRow, ImportProgressRow } from '../media/ImportProgress'
import { useMediaImport, type MediaImport } from '../media/useMediaImport'
import { ViewButton } from '../media/ViewButton'
import { useMediaViewer, viewerItem } from '../media/viewerContext'
import { pastedFiles } from '../media/fileSources'

interface PartEditorProps {
  part: DraftPart
  index: number
  count: number
  canMoveUp: boolean
  canMoveDown: boolean
  problem: string | null
  textRef?: React.Ref<HTMLTextAreaElement>
  onText: (text: string) => void
  onMove: (step: -1 | 1) => void
  onRemove: () => void
  /** The part's own import slot comes along, so its progress and errors show in the part. */
  onPick: (importer: MediaImport) => void
  onFiles: (files: File[], importer: MediaImport) => void
  onRemoveMedia: (id: string) => void
  onAlt: (id: string, alt: string) => void
}

/** One post of the thread: its text, counter, media and controls. */
export function PartEditor({ textRef, ...props }: PartEditorProps): React.JSX.Element {
  const { part, index, count } = props
  const thread = count > 1
  const label = thread ? `Post ${index + 1} of ${count}` : 'Post text'
  const measure = measureText(part.text)
  const importer = useMediaImport()

  function filesFrom(list: FileList | null): File[] {
    return list ? Array.from(list) : []
  }

  if (part.locked) {
    return (
      <section
        className="flex flex-col gap-2 rounded-xl border border-ds-border bg-ds-inset px-3.5 py-3 opacity-80"
        aria-label={label}
      >
        {thread && <p className="m-0 text-[12px] font-medium text-ds-text-3">{label} · on X</p>}
        <p className="m-0 text-[14px] leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere]">
          {part.text}
        </p>
        <MediaStrip media={part.media} partLabel={thread ? `Part ${index + 1}` : undefined} />
        {part.remoteUrl && (
          <a
            className="text-[12px] text-ds-accent-text no-underline"
            href={part.remoteUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on X
          </a>
        )}
      </section>
    )
  }

  return (
    <section
      className={`flex flex-col gap-2.5 rounded-xl border bg-ds-inset px-3.5 py-3 focus-within:border-ds-accent ${props.problem ? 'border-ds-red' : 'border-ds-border'}`}
      aria-label={label}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        const files = filesFrom(e.dataTransfer.files)
        if (files.length === 0) return
        e.preventDefault()
        props.onFiles(files, importer)
      }}
    >
      {thread && (
        <div className="flex items-center gap-2">
          <span className="grid size-5 place-items-center rounded-full border border-ds-border-strong bg-ds-raised text-[11px] font-semibold text-ds-text-2">
            {index + 1}
          </span>
          <span className="flex-1 text-[12px] font-medium text-ds-text-3">{label}</span>
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              className="grid size-6 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-ds-text-3 hover:bg-ds-raised hover:text-ds-text disabled:cursor-default disabled:opacity-30"
              disabled={!props.canMoveUp}
              onClick={() => props.onMove(-1)}
              aria-label={`Move post ${index + 1} up`}
            >
              <ArrowUp size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="grid size-6 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-ds-text-3 hover:bg-ds-raised hover:text-ds-text disabled:cursor-default disabled:opacity-30"
              disabled={!props.canMoveDown}
              onClick={() => props.onMove(1)}
              aria-label={`Move post ${index + 1} down`}
            >
              <ArrowDown size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="grid size-6 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-ds-text-3 hover:bg-ds-raised hover:text-ds-text disabled:cursor-default disabled:opacity-30"
              onClick={props.onRemove}
              aria-label={`Remove post ${index + 1}`}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </span>
        </div>
      )}
      <label className="block">
        <span className="sr-only">{label}</span>
        <textarea
          ref={textRef}
          value={part.text}
          rows={thread ? 3 : 5}
          className="w-full resize-none border-0 bg-transparent p-0 font-sans text-[14px] leading-[1.5] text-ds-text outline-none placeholder:text-ds-text-3"
          placeholder={index === 0 ? 'What do you want to say?' : 'Add to the thread'}
          onChange={(e) => props.onText(e.target.value)}
          onPaste={(e) => {
            const files = pastedFiles(e)
            if (files.length === 0) return
            e.preventDefault()
            props.onFiles(files, importer)
          }}
        />
      </label>
      {importer.progress && (
        <ImportProgressRow
          variant="editor"
          progress={importer.progress}
          onCancel={importer.cancel}
        />
      )}
      {importer.error && <ImportErrorRow message={importer.error} onDismiss={importer.dismiss} />}
      <MediaStrip
        media={part.media}
        partLabel={thread ? `Part ${index + 1}` : undefined}
        onRemove={props.onRemoveMedia}
        onAlt={props.onAlt}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={importer.pending}
          onClick={() => props.onPick(importer)}
        >
          {importer.pending ? 'Adding…' : 'Add media'}
        </Button>
        <span
          className={`ml-auto font-mono text-[11px] ${measure.over ? 'editor-counter-over font-semibold text-ds-red' : 'text-ds-text-3'}`}
          data-testid="counter"
          aria-live="polite"
        >
          {measure.length} / {measure.max}
        </span>
      </div>
      {props.problem && (
        <p className="m-0 text-[12px] text-ds-red" role="alert">
          {props.problem}
        </p>
      )}
    </section>
  )
}

/** The part's files; a click on one opens the viewer on this part's media (OP-88). */
function MediaStrip({
  media,
  partLabel,
  onRemove,
  onAlt
}: {
  media: PostMedia[]
  partLabel?: string
  onRemove?: (id: string) => void
  onAlt?: (id: string, alt: string) => void
}): React.JSX.Element | null {
  const viewer = useMediaViewer()
  if (media.length === 0) return null
  return (
    <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
      {media.map((item, i) => (
        <li key={item.id} className="relative flex w-[88px] flex-col gap-1">
          <ViewButton
            kind={item.kind}
            onOpen={() =>
              viewer.open(
                media.map((m) => viewerItem(m, partLabel)),
                i
              )
            }
            className="size-[88px] overflow-hidden rounded-lg"
          >
            {item.kind === 'video' ? (
              <video
                src={item.url}
                preload="metadata"
                muted
                aria-label={`Video ${i + 1}`}
                className="block size-full object-cover"
              />
            ) : (
              <img
                src={item.url}
                alt={item.alt ?? `${item.kind === 'gif' ? 'GIF' : 'Image'} ${i + 1}`}
                className="block size-full object-cover"
              />
            )}
          </ViewButton>
          {onRemove && (
            <button
              type="button"
              className="absolute top-1 right-1 grid size-5 cursor-pointer place-items-center rounded-full border-0 bg-black/65 text-[12px] text-white"
              onClick={() => onRemove(item.id)}
              aria-label={`Remove ${item.kind === 'video' ? 'video' : item.kind === 'gif' ? 'GIF' : 'image'} ${i + 1}`}
            >
              ×
            </button>
          )}
          {onAlt && item.kind !== 'video' && (
            <input
              className="h-6 w-full rounded-md border border-ds-border bg-ds-surface px-1.5 font-sans text-[11px] text-ds-text placeholder:text-ds-text-3"
              type="text"
              value={item.alt ?? ''}
              maxLength={1000}
              placeholder="Alt text"
              aria-label={`Alt text for image ${i + 1}`}
              onChange={(e) => onAlt(item.id, e.target.value)}
            />
          )}
        </li>
      ))}
    </ul>
  )
}
