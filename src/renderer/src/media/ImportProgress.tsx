import { CircleAlert, Film, X } from 'lucide-react'
import type { ImportProgress } from './useMediaImport'

interface ProgressRowProps {
  progress: ImportProgress
  onCancel: () => void
  /** The editor's row, in a part, or the chat composer's smaller one. */
  variant: 'editor' | 'composer'
}

/** A video being converted for X, with a Cancel. Pencil "OP-67 · Import progress". */
export function ImportProgressRow({
  progress,
  onCancel,
  variant
}: ProgressRowProps): React.JSX.Element {
  const percent = Math.round(Math.min(1, Math.max(0, progress.fraction)) * 100)
  const editor = variant === 'editor'
  return (
    <div
      className={`flex items-center rounded-[10px] border border-ds-border-strong ${editor ? 'gap-3 bg-ds-inset px-3 py-2.5' : 'gap-2.5 bg-ds-raised px-2.5 py-2'}`}
      role="status"
      aria-label={`Converting ${progress.name} for X`}
    >
      {editor ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ds-raised">
          <Film size={16} className="text-ds-text-2" aria-hidden="true" />
        </span>
      ) : (
        <Film size={14} className="shrink-0 text-ds-text-2" aria-hidden="true" />
      )}
      <div className={`flex min-w-0 flex-1 flex-col ${editor ? 'gap-1.5' : 'gap-[5px]'}`}>
        <div className={`flex items-center ${editor ? 'gap-2' : 'gap-1.5'}`}>
          <span className="truncate text-[12px] font-medium text-ds-text">{progress.name}</span>
          {editor && (
            <span className="shrink-0 text-[12px] whitespace-nowrap text-ds-text-3">
              Converting for X
            </span>
          )}
          <span className="flex-1" />
          <span className="shrink-0 font-mono text-[11px] text-ds-text-2">{percent}%</span>
        </div>
        <div
          className="relative h-1 overflow-hidden rounded-[2px] bg-ds-border"
          role="progressbar"
          aria-label="Conversion progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-[2px] bg-ds-accent"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      {editor ? (
        <button
          type="button"
          className="h-7 shrink-0 cursor-pointer rounded-lg border border-ds-border-strong bg-transparent px-2.5 font-sans text-[12px] font-medium text-ds-text-2 hover:bg-ds-raised hover:text-ds-text"
          onClick={onCancel}
        >
          Cancel
        </button>
      ) : (
        <button
          type="button"
          className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-ds-text-2 hover:bg-ds-surface hover:text-ds-text"
          onClick={onCancel}
          aria-label="Cancel adding the video"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** Why an import was refused, in the words main used, until the user dismisses it. */
export function ImportErrorRow({
  message,
  onDismiss
}: {
  message: string
  onDismiss: () => void
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] bg-ds-red-2 px-3 py-2.5" role="alert">
      <CircleAlert size={16} className="shrink-0 text-ds-red" aria-hidden="true" />
      <p className="m-0 min-w-0 flex-1 text-[12px] leading-[1.45] text-ds-red [overflow-wrap:anywhere]">
        {message}
      </p>
      <button
        type="button"
        className="grid size-4 shrink-0 cursor-pointer place-items-center border-0 bg-transparent p-0 text-ds-red"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
