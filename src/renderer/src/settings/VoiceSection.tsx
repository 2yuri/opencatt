import { useEffect, useId, useRef, useState } from 'react'
import { Plus, Sparkles, X } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import type { VoiceProfile, XAccount } from '@shared/api'
import { MAX_POST_LENGTH, measureText } from '../editor/postText'
import { useActiveAccount } from '../shell/useActiveAccount'
import { Segmented, SegmentedItem, Switch } from '../ui'
import { AdvancedPrompts } from './AdvancedPrompts'
import { BOX, HEADING, LINK, ROW_SUB, ROW_TITLE, SECTION, messageOf } from './common'
import { Row, Select } from './parts'
import { IMAGE_CHOICES, LANGUAGES, MAX_EXAMPLES, voicePreview } from './voice'

const TEXTAREA =
  'box-border min-h-[88px] w-full resize-y rounded-lg border border-ds-border-strong bg-ds-inset px-3 py-2.5 font-sans text-[13px] leading-[1.5] text-ds-text outline-none placeholder:text-ds-text-3 focus:border-ds-accent'

/**
 * Settings, Voice (OP-75): how the active X account's posts should sound. Every change saves on
 * its own, with just the field that changed; the Advanced prompts below apply to every account.
 */
export function VoiceSection({
  onLoaded
}: {
  /** Told once the voice is on screen, so a section below can scroll to itself (OP-104). */
  onLoaded?: () => void
} = {}): React.JSX.Element {
  const { status, active } = useActiveAccount()
  const headingId = useId()
  const ref = useRef<HTMLElement>(null)
  const location = useLocation()
  const known = status !== null

  // Set once the voice has loaded: before that the page may be too short to scroll.
  const [loaded, setLoaded] = useState(false)

  // /settings#voice, from the agent panel's header: bring the section into view once it is drawn.
  useEffect(() => {
    if (known && location.hash === '#voice') ref.current?.scrollIntoView?.({ block: 'start' })
  }, [known, loaded, location.hash, location.key])

  useEffect(() => {
    if (loaded) onLoaded?.()
  }, [loaded, onLoaded])

  return (
    <section id="voice" ref={ref} className={`${SECTION} scroll-mt-6`} aria-labelledby={headingId}>
      {active ? (
        <VoiceEditor key={active.id} account={active} headingId={headingId} onLoaded={setLoaded} />
      ) : (
        <>
          <h2 id={headingId} className={HEADING}>
            Voice
          </h2>
          {known && (
            <p className="m-0 px-1 text-[13px] text-ds-text-2">
              <Link to="/integrations" className={LINK}>
                Connect an X account
              </Link>{' '}
              to set its voice.
            </p>
          )}
        </>
      )}
      <AdvancedPrompts />
    </section>
  )
}

function VoiceEditor({
  account,
  headingId,
  onLoaded
}: {
  account: XAccount
  headingId: string
  /** Told once the voice is on screen; a state setter, so it stays the same function. */
  onLoaded: (loaded: true) => void
}): React.JSX.Element {
  const id = account.id
  const [profile, setProfile] = useState<VoiceProfile | null>(null)
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const descriptionId = useId()
  const descriptionSubId = useId()
  const languageId = useId()
  const emojiId = useId()
  const emojiSubId = useId()
  const hashtagsId = useId()
  const imagesId = useId()
  const imagesSubId = useId()

  useEffect(() => {
    let live = true
    window.opencat.voice
      .get(id)
      .then((next) => {
        if (!live) return
        setProfile(next)
        setDescription(next.description)
        onLoaded(true)
      })
      .catch((err: unknown) => live && setError(`Could not load this voice: ${messageOf(err)}`))
    // Saved from elsewhere, like another window: show it, but don't overwrite text being typed.
    const off = window.opencat.voice.onChanged((event) => {
      if (!live || event.accountId !== id) return
      setProfile(event.profile)
      if (document.activeElement !== descriptionRef.current)
        setDescription(event.profile.description)
    })
    return () => {
      live = false
      off()
      clearTimeout(savedTimer.current)
    }
  }, [id, onLoaded])

  const save = (patch: Partial<VoiceProfile>): void => {
    if (!profile) return
    const before = profile
    setProfile({ ...profile, ...patch })
    setError(null)
    window.opencat.voice
      .set(id, patch)
      .then((next) => {
        setProfile(next)
        setSaved(true)
        clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => setSaved(false), 1600)
      })
      .catch((err: unknown) => {
        // The description keeps what was typed, so it can be fixed and saved again.
        setProfile(before)
        setError(messageOf(err))
      })
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <h2 id={headingId} className={HEADING}>
          Voice
        </h2>
        <span className="text-[11px] text-ds-text-3">for @{account.handle}</span>
        <span
          aria-live="polite"
          className={`ml-auto text-[12px] text-ds-text-3 transition-opacity duration-500 ${saved ? 'opacity-100' : 'opacity-0'}`}
        >
          {saved ? 'Saved' : ''}
        </span>
      </div>
      {error && (
        <p role="alert" className="m-0 text-[12px] leading-[1.45] text-ds-red">
          {error}
        </p>
      )}
      {profile && (
        <>
          <div className={BOX}>
            <div className="flex flex-col gap-2.5 px-4 py-3.5">
              <div className="flex flex-col gap-[3px]">
                <label htmlFor={descriptionId} className={ROW_TITLE}>
                  How should your posts sound?
                </label>
                <span id={descriptionSubId} className={ROW_SUB}>
                  The agent follows this for every post from this account.
                </span>
              </div>
              <textarea
                id={descriptionId}
                ref={descriptionRef}
                aria-describedby={descriptionSubId}
                className={TEXTAREA}
                placeholder="e.g. Friendly and direct. Short sentences. Talk to other founders, not to investors."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => {
                  if (description !== profile.description) save({ description })
                }}
              />
            </div>
            <Examples examples={profile.examples} onSave={(examples) => save({ examples })} />
            <Row
              title="Language"
              titleFor={languageId}
              control={
                <Select
                  id={languageId}
                  value={profile.language}
                  onChange={(e) => save({ language: e.target.value })}
                >
                  {/* A code saved elsewhere that the list doesn't have stays selectable. */}
                  {!LANGUAGES.some((l) => l.value === profile.language) && (
                    <option value={profile.language}>{profile.language}</option>
                  )}
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </Select>
              }
            />
            <Row
              title="Emoji"
              titleId={emojiId}
              sub="Only where they'd feel natural"
              subId={emojiSubId}
              control={
                <Switch
                  checked={profile.emoji}
                  aria-labelledby={emojiId}
                  aria-describedby={emojiSubId}
                  onClick={() => save({ emoji: !profile.emoji })}
                />
              }
            />
            <Row
              title="Hashtags"
              titleId={hashtagsId}
              control={
                <Switch
                  checked={profile.hashtags}
                  aria-labelledby={hashtagsId}
                  onClick={() => save({ hashtags: !profile.hashtags })}
                />
              }
            />
            <Row
              title="Images with posts"
              titleId={imagesId}
              sub="Whether the agent designs an image for a post"
              subId={imagesSubId}
              control={
                <Segmented
                  role="group"
                  aria-labelledby={imagesId}
                  aria-describedby={imagesSubId}
                  className="shrink-0"
                >
                  {IMAGE_CHOICES.map((c) => (
                    <SegmentedItem
                      key={c.value}
                      aria-pressed={profile.images === c.value}
                      onClick={() => profile.images !== c.value && save({ images: c.value })}
                    >
                      {c.label}
                    </SegmentedItem>
                  ))}
                </Segmented>
              }
            />
          </div>
          <p className="m-0 flex items-center gap-2 px-1 text-[12px] leading-[1.45] text-ds-text-3">
            <Sparkles size={14} className="shrink-0 text-ds-accent-text" aria-hidden="true" />
            {voicePreview(profile)}
          </p>
        </>
      )}
    </>
  )
}

/** Where an edit is: an example's index, or the end of the list for a new one. */
interface Editing {
  index: number
  text: string
}

function Examples({
  examples,
  onSave
}: {
  examples: string[]
  onSave: (examples: string[]) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState<Editing | null>(null)
  const titleId = useId()
  const subId = useId()
  const adding = editing !== null && editing.index >= examples.length
  const full = examples.length + (adding ? 1 : 0) >= MAX_EXAMPLES

  // Blur ends an edit: an empty text drops the example, one too long for X stays open. Answers
  // the list as it now is, or null while the edit has to stay open.
  const commit = (): string[] | null => {
    if (!editing) return examples
    const text = editing.text.trim()
    if (measureText(text).over) return null
    setEditing(null)
    const next = [...examples]
    if (text === '') {
      if (editing.index >= examples.length) return examples
      next.splice(editing.index, 1)
    } else if (text === examples[editing.index]) {
      return examples
    } else {
      next[editing.index] = text
    }
    onSave(next)
    return next
  }

  const remove = (index: number): void => {
    setEditing(null)
    if (index < examples.length) onSave(examples.filter((_, i) => i !== index))
  }

  const cards = adding ? [...examples, editing.text] : examples

  return (
    <div
      className="flex flex-col gap-2.5 px-4 py-3.5"
      role="group"
      aria-labelledby={titleId}
      aria-describedby={subId}
    >
      <div className="flex flex-col gap-[3px]">
        <span id={titleId} className={ROW_TITLE}>
          Example posts
        </span>
        <span id={subId} className={ROW_SUB}>
          Posts that sound right. 3 to 10 work best.
        </span>
      </div>
      {cards.map((example, index) =>
        editing?.index === index ? (
          <ExampleEditor
            key={index}
            text={editing.text}
            onChange={(text) => setEditing({ index, text })}
            onCommit={() => void commit()}
            onCancel={() => setEditing(null)}
            onRemove={() => remove(index)}
          />
        ) : (
          <div
            key={index}
            className="box-border flex items-start gap-2.5 rounded-lg border border-ds-border bg-ds-inset px-3 py-2.5"
          >
            <button
              type="button"
              className="min-w-0 flex-1 cursor-text border-0 bg-transparent p-0 text-left text-[12px] leading-[18px] break-words whitespace-pre-wrap text-ds-text-2 hover:text-ds-text"
              onClick={() => setEditing({ index, text: example })}
            >
              {example}
            </button>
            <RemoveButton onClick={() => remove(index)} />
          </div>
        )
      )}
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 text-[13px] font-medium text-ds-accent-text hover:underline disabled:cursor-default disabled:opacity-45 disabled:hover:no-underline"
        disabled={full}
        title={full ? `Up to ${MAX_EXAMPLES} examples` : undefined}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const list = commit()
          if (list && list.length < MAX_EXAMPLES) setEditing({ index: list.length, text: '' })
        }}
      >
        <Plus size={14} aria-hidden="true" />
        Add an example
      </button>
    </div>
  )
}

function ExampleEditor({
  text,
  onChange,
  onCommit,
  onCancel,
  onRemove
}: {
  text: string
  onChange: (text: string) => void
  onCommit: () => void
  onCancel: () => void
  onRemove: () => void
}): React.JSX.Element {
  const measure = measureText(text.trim())
  const countId = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={`box-border flex items-start gap-2.5 rounded-lg border bg-ds-inset px-3 py-2.5 ${measure.over ? 'border-ds-red' : 'border-ds-accent'}`}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <textarea
            aria-label="Example post"
            aria-describedby={countId}
            aria-invalid={measure.over}
            autoFocus
            className="box-border min-h-[18px] w-full resize-none border-0 bg-transparent p-0 font-sans text-[12px] leading-[18px] text-ds-text outline-none [field-sizing:content] placeholder:text-ds-text-3"
            placeholder="Paste or write a post that sounds like you"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onCommit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                onCancel()
              }
            }}
          />
          <span
            id={countId}
            className={`self-end font-mono text-[11px] ${measure.over ? 'text-ds-red' : 'text-ds-text-3'}`}
          >
            {measure.length} / {MAX_POST_LENGTH}
          </span>
        </div>
        <RemoveButton onClick={onRemove} />
      </div>
      {measure.over && (
        <p role="alert" className="m-0 text-[12px] leading-[1.45] text-ds-red">
          Too long for one post: X counts {measure.length} of {MAX_POST_LENGTH} characters.
        </p>
      )}
    </div>
  )
}

function RemoveButton({ onClick }: { onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label="Remove example"
      className="grid size-[18px] shrink-0 cursor-pointer place-items-center border-0 bg-transparent p-0 text-ds-text-3 hover:text-ds-text"
      // Keeps an open edit from committing on blur before the removal.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <X size={14} aria-hidden="true" />
    </button>
  )
}
