import { useEffect, useState } from 'react'
import { ArrowUp, Film, Image as ImageIcon, LoaderCircle, Paperclip, Square, X } from 'lucide-react'
import type { ComposerMode } from '@shared/api'
import { LengthPicker } from './LengthPicker'
import { ModeRow } from './ModeRow'
import { MODE_COPY } from './modes'
import type { Attachment, Attachments } from './useAttachments'
import { pastedFiles } from '../media/fileSources'
import { ImportErrorRow, ImportProgressRow } from '../media/ImportProgress'
import { ViewButton } from '../media/ViewButton'
import { useMediaViewer, viewerItem } from '../media/viewerContext'

interface Props {
  running: boolean
  /** render_video is running: the mode row gives way to how long it has been recording. */
  recording?: boolean
  /** Nothing can answer yet: the setup card above says what to do. */
  disabled?: boolean
  /** Typing is fine but sending waits, because another chat is answering (OP-95). */
  blocked?: boolean
  /** One line above the box, such as why sending is waiting on another chat (OP-95). */
  notice?: React.ReactNode
  attachments: Attachments
  onSend: (text: string, mediaIds: string[], mode: ComposerMode, videoSeconds: number) => void
  onStop: () => void
}

/**
 * Enter sends, Shift+Enter adds a line. While the agent answers, the button stops it. Files wait
 * in a strip above the text (Pencil "OP-21 v2 · Attachments in chat") and go with the message.
 */
export function Composer({
  running,
  recording = false,
  disabled = false,
  notice = null,
  blocked = false,
  attachments,
  onSend,
  onStop
}: Props): React.JSX.Element {
  const [text, setText] = useState('')
  const [mode, setMode] = useState<ComposerMode>('text')
  // Kept between messages, so a second video is the same length unless changed.
  const [videoSeconds, setVideoSeconds] = useState(15)
  const [videoUnavailable, setVideoUnavailable] = useState<string | null>(null)
  const files = attachments.list
  const viewer = useMediaViewer()

  useEffect(() => {
    let live = true
    window.opencat.agent
      .capabilities?.()
      .then((c) => live && setVideoUnavailable(c.videoUnavailable))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  // The spinner tile holds the place until a video's progress row takes over.
  const spinner = attachments.busy && !attachments.progress
  const canSend =
    !running &&
    !disabled &&
    !blocked &&
    !attachments.busy &&
    (text.trim().length > 0 || files.length > 0)

  const send = (): void => {
    if (!canSend) return
    onSend(text.trim(), attachments.take(), mode, videoSeconds)
    setText('')
    // One message at a time: the next one is text again unless picked again.
    setMode('text')
  }

  return (
    <form
      className="shrink-0 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      {notice && (
        <p className="m-0 text-[12px] leading-[1.45] text-ds-text-3" role="status">
          {notice}
        </p>
      )}
      {recording ? (
        <RecordingRow />
      ) : (
        <ModeRow
          mode={mode}
          onMode={setMode}
          videoUnavailable={videoUnavailable}
          disabled={disabled}
        />
      )}
      <div
        className={`flex flex-col gap-2.5 rounded-xl border border-ds-border-strong ${recording ? 'opacity-70' : ''} bg-ds-inset px-3 py-2.5 focus-within:border-ds-accent`}
      >
        {(files.length > 0 || spinner) && (
          <ul className="m-0 flex list-none flex-wrap gap-[8px] p-0" aria-label="Attached files">
            {files.map((file, i) => (
              <li key={file.media.id} className="relative h-[56px]">
                <ViewButton
                  kind={file.media.kind}
                  onOpen={() =>
                    viewer.open(
                      files.map((f) => ({ ...viewerItem(f.media), name: f.name ?? undefined })),
                      i
                    )
                  }
                  className="rounded-[8px]"
                >
                  <FileTile file={file} />
                </ViewButton>
                <button
                  type="button"
                  className={`absolute top-[2px] grid size-[20px] ${file.media.kind === 'video' ? 'right-[2px]' : 'left-[34px]'} cursor-pointer place-items-center rounded-full border border-ds-border-strong bg-ds-surface p-0 text-ds-text`}
                  onClick={() => attachments.remove(file.media.id)}
                  aria-label={`Remove ${file.name ?? file.media.kind}`}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </li>
            ))}
            {spinner && (
              <li className="grid size-[56px] place-items-center rounded-[8px] border border-ds-border-strong">
                <span className="spinner" aria-label="Adding files" />
              </li>
            )}
          </ul>
        )}
        {attachments.progress && (
          <ImportProgressRow
            variant="composer"
            progress={attachments.progress}
            onCancel={attachments.cancel}
          />
        )}
        {attachments.error && (
          <ImportErrorRow message={attachments.error} onDismiss={attachments.dismiss} />
        )}
        <textarea
          className="min-h-[40px] w-full resize-none border-0 bg-transparent p-0 font-sans text-[13px] leading-[1.5] text-ds-text outline-none placeholder:text-ds-text-3"
          aria-label="Message the agent"
          placeholder={
            disabled
              ? 'Set up the agent to start chatting'
              : MODE_COPY[recording ? 'video' : mode].placeholder
          }
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            // Images and copied files attach like a dropped file; text pastes as text (OP-89).
            const pasted = pastedFiles(e)
            if (pasted.length === 0 || disabled) return
            e.preventDefault()
            void attachments.addFiles(pasted)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`grid size-[20px] cursor-pointer place-items-center border-0 bg-transparent p-0 hover:text-ds-text disabled:cursor-default disabled:opacity-40 ${files.length ? 'text-ds-text-2' : 'text-ds-text-3'}`}
            onClick={() => void attachments.pick()}
            disabled={disabled || attachments.busy}
            aria-label="Attach images or a video"
            title="Attach images or a video"
          >
            <Paperclip size={16} aria-hidden="true" />
          </button>
          {mode === 'video' && !recording && (
            <LengthPicker seconds={videoSeconds} onChange={setVideoSeconds} disabled={disabled} />
          )}
          <span className="flex-1" />
          <span className="font-mono text-[11px] text-ds-text-3" aria-hidden="true">
            ↵ send · ⇧↵ new line
          </span>
          {running ? (
            <button
              type="button"
              className="grid size-[28px] cursor-pointer place-items-center rounded-lg border border-ds-border-strong bg-ds-raised p-0 text-ds-text"
              onClick={onStop}
              aria-label="Stop"
            >
              <Square size={12} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              className="grid size-7 cursor-pointer place-items-center rounded-lg border-0 bg-ds-accent text-white disabled:cursor-default disabled:opacity-40"
              disabled={!canSend}
              aria-label={MODE_COPY[mode].send}
              title={MODE_COPY[mode].send}
            >
              {mode === 'image' ? (
                <ImageIcon size={15} aria-hidden="true" />
              ) : mode === 'video' ? (
                <Film size={15} aria-hidden="true" />
              ) : (
                <ArrowUp size={15} aria-hidden="true" />
              )}
            </button>
          )}
        </div>
      </div>
    </form>
  )
}

/** Pencil "OP-79 · Mode states", Video running: how long the recording has taken so far. */
function RecordingRow(): React.JSX.Element {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [])
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <div
      className="mb-[8px] flex items-center gap-[8px] rounded-[8px] border border-ds-border bg-ds-raised px-[10px] py-[8px]"
      role="status"
    >
      <LoaderCircle size={14} className="animate-spin text-ds-accent-text" aria-hidden="true" />
      <span className="flex-1 text-[12px] font-medium text-ds-text">Recording the video…</span>
      <span className="font-mono text-[11px] text-ds-text-3">{clock} / up to 1:00</span>
    </div>
  )
}

/** "0:24 · 12 MB", or just the size when the length isn't known. */
function fileMeta(file: Attachment): string {
  const mb = file.media.bytes / (1024 * 1024)
  const size =
    mb >= 1 ? `${Math.round(mb)} MB` : `${Math.max(1, Math.round(file.media.bytes / 1024))} KB`
  const ms = file.media.durationMs
  if (ms === null) return size
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · ${size}`
}

function FileTile({ file }: { file: Attachment }): React.JSX.Element {
  if (file.media.kind === 'video') {
    return (
      <div className="flex h-[56px] items-center gap-[8px] rounded-[8px] border border-ds-border-strong bg-ds-raised pr-[28px] pl-[10px]">
        <Film size={18} className="text-ds-text-2" aria-hidden="true" />
        <span className="flex flex-col gap-[1px]">
          <span className="max-w-[140px] truncate text-[12px] font-medium text-ds-text">
            {file.name ?? 'Video'}
          </span>
          <span className="font-mono text-[10px] text-ds-text-3">{fileMeta(file)}</span>
        </span>
      </div>
    )
  }
  return (
    <img
      src={file.media.url}
      alt={file.name ?? ''}
      className="block size-[56px] rounded-[8px] border border-ds-border-strong object-cover"
    />
  )
}
