import { useEffect, useId, useState } from 'react'
import { ChevronDown, ChevronRight, Info, RotateCcw } from 'lucide-react'
import type { WritingPrompt } from '@shared/api'
import { Button } from '../ui'
import { BOX, ROW_SUB, ROW_TITLE, messageOf } from './common'

/** What main accepts (OP-74, OP-81): longer or empty texts are rejected. */
const WRITING_GUIDE_LIMIT = 20_000
const VIDEO_PROMPT_LIMIT = 4_000

const count = (n: number): string => n.toLocaleString('en-US')

interface PromptCalls {
  load: () => Promise<WritingPrompt>
  save: (text: string) => Promise<WritingPrompt>
  reset: () => Promise<WritingPrompt>
}

const WRITING_GUIDE: PromptCalls = {
  load: () => window.opencat.voice.getWritingPrompt(),
  save: (text) => window.opencat.voice.setWritingPrompt(text),
  reset: () => window.opencat.voice.resetWritingPrompt()
}

const VIDEO_PROMPT: PromptCalls = {
  load: () => window.opencat.video.getPrePrompt(),
  save: (text) => window.opencat.video.setPrePrompt(text),
  reset: () => window.opencat.video.resetPrePrompt()
}

/**
 * Settings, Voice, Advanced (OP-75): the writing guide and Video mode's prompt, shared by every
 * account. Collapsed until asked for; each editor saves on its own.
 */
export function AdvancedPrompts(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <div className="mt-1 flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className="flex cursor-pointer items-center gap-2 self-start border-0 bg-transparent px-1 py-0 text-ds-text-2 hover:text-ds-text"
        onClick={() => setOpen(!open)}
      >
        <Chevron size={14} className="text-ds-text-3" aria-hidden="true" />
        <span className="text-[13px] font-medium">Advanced</span>
        <span className="text-[12px] text-ds-text-3">· applies to every account</span>
      </button>
      {open && (
        <div id={panelId} className="flex flex-col gap-3">
          <div className={BOX}>
            <PromptEditor
              title="Writing guide"
              sub="The base rules the agent follows for every post on X, before each account's voice."
              limit={WRITING_GUIDE_LIMIT}
              calls={WRITING_GUIDE}
            />
            <PromptEditor
              title="Video prompt"
              sub="What the agent is told before it makes a video in Video mode."
              limit={VIDEO_PROMPT_LIMIT}
              calls={VIDEO_PROMPT}
              chip={
                <span className="box-border inline-flex h-[22px] shrink-0 items-center gap-1 rounded-md border border-ds-border bg-ds-inset px-2 text-[11px] text-ds-text-3">
                  <code className="font-mono text-ds-accent-text">{'{duration}'}</code>= the video
                  length
                </span>
              }
            />
          </div>
          <p className="m-0 flex items-center gap-2 px-1 text-[12px] leading-[1.45] text-ds-text-3">
            <Info size={14} className="shrink-0" aria-hidden="true" />
            Changes apply from the next message. Reset asks before replacing your text.
          </p>
        </div>
      )}
    </div>
  )
}

function PromptEditor({
  title,
  sub,
  limit,
  calls,
  chip
}: {
  title: string
  sub: string
  limit: number
  calls: PromptCalls
  chip?: React.ReactNode
}): React.JSX.Element {
  const [saved, setSaved] = useState<WritingPrompt | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const titleId = useId()
  const subId = useId()
  const countId = useId()

  useEffect(() => {
    let live = true
    calls
      .load()
      .then((next) => {
        if (!live) return
        setSaved(next)
        setText(next.text)
      })
      .catch((err: unknown) => live && setError(messageOf(err)))
    return () => {
      live = false
    }
  }, [calls])

  const apply = (call: () => Promise<WritingPrompt>): void => {
    setBusy(true)
    setError(null)
    call()
      .then((next) => {
        setSaved(next)
        setText(next.text)
      })
      .catch((err: unknown) => setError(messageOf(err)))
      .finally(() => setBusy(false))
  }

  const over = text.length > limit
  const canSave = saved !== null && !busy && text !== saved.text && text.trim() !== '' && !over
  const edited = saved !== null && !saved.isDefault

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span id={titleId} className={ROW_TITLE}>
            {title}
          </span>
          <span id={subId} className={ROW_SUB}>
            {sub}
          </span>
        </div>
        {saved && (
          <span
            className={`box-border inline-flex h-5 shrink-0 items-center rounded-[10px] px-2 text-[11px] font-medium ${edited ? 'bg-ds-accent-2 text-ds-accent-text' : 'border border-ds-border bg-ds-inset text-ds-text-3'}`}
          >
            {edited ? 'Edited' : 'Default'}
          </span>
        )}
      </div>
      <textarea
        aria-labelledby={titleId}
        aria-describedby={`${subId} ${countId}`}
        aria-invalid={over}
        className="box-border h-[150px] min-h-[88px] w-full resize-y rounded-lg border border-ds-border-strong bg-ds-inset px-3 py-2.5 font-mono text-[11px] leading-[18px] text-ds-text-2 outline-none focus:border-ds-accent focus:text-ds-text"
        spellCheck={false}
        disabled={saved === null}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex min-h-[30px] flex-wrap items-center gap-2.5">
        {chip}
        <span
          id={countId}
          className={`font-mono text-[11px] ${over ? 'text-ds-red' : 'text-ds-text-3'}`}
        >
          {count(text.length)} / {count(limit)}
        </span>
        <span className="flex-1" />
        {confirming ? (
          <span className="flex items-center gap-1.5 text-[12px] text-ds-text-2">
            Replace your text with the built-in one?
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                setConfirming(false)
                apply(calls.reset)
              }}
            >
              Reset
            </Button>
          </span>
        ) : (
          <>
            <button
              type="button"
              className="flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border-0 bg-transparent px-2.5 text-[12px] font-medium text-ds-text-2 hover:not-disabled:text-ds-text disabled:cursor-default disabled:opacity-45"
              disabled={!edited || busy}
              onClick={() => setConfirming(true)}
            >
              <RotateCcw size={14} aria-hidden="true" />
              Reset to default
            </button>
            <button
              type="button"
              className="h-[30px] cursor-pointer rounded-lg border-0 bg-ds-accent px-3.5 text-[12px] font-medium text-white hover:not-disabled:bg-[color-mix(in_srgb,var(--ds-accent)_88%,#fff)] disabled:cursor-default disabled:opacity-45"
              disabled={!canSave}
              onClick={() => apply(() => calls.save(text))}
            >
              Save
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="m-0 text-[12px] leading-[1.45] text-ds-red">
          {error}
        </p>
      )}
    </div>
  )
}
