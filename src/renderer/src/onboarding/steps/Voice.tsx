import { useEffect, useId, useState } from 'react'
import type { VoiceImages, XAccount } from '@shared/api'
import { IMAGE_CHOICES, LANGUAGES } from '../../settings/voice'
import { Select } from '../../settings/parts'
import { Segmented, SegmentedItem } from '../../ui'
import { box, messageOf, spacer } from '../helpers'
import { BackButton, ErrorBox, NextButton, StepPage } from '../shared'

/** The starter chips: each adds its phrase to the description. */
const STARTERS: { label: string; phrase: string }[] = [
  { label: 'Friendly', phrase: 'Friendly and warm.' },
  { label: 'Direct', phrase: 'Direct and to the point.' },
  { label: 'Funny', phrase: 'A bit of humour where it fits.' },
  { label: 'Expert', phrase: 'Speaks as an expert, with specifics.' }
]

const ROW = 'flex items-center gap-4 px-[18px] py-[14px]'

/**
 * OP-75: a first voice for the account just connected, in the user's words. Skips itself when
 * no account is connected, since a voice belongs to one.
 */
export function VoiceStep({
  onBack,
  onNext,
  onSkip
}: {
  onBack: () => void
  onNext: () => void
  /** Moves on the way the user was going, when there is no account to set a voice for. */
  onSkip: () => void
}): React.JSX.Element | null {
  const [account, setAccount] = useState<XAccount | null>(null)
  const [description, setDescription] = useState('')
  const [language, setLanguage] = useState('auto')
  const [images, setImages] = useState<VoiceImages>('ask')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const descriptionId = useId()
  const languageId = useId()
  const imagesId = useId()
  const imagesSubId = useId()

  useEffect(() => {
    let live = true
    // Pasted keys or a build without X sign-in have no accounts to look up.
    const status = window.opencat.auth?.status
    if (!status) {
      onSkip()
      return
    }
    status()
      .then((next) => {
        if (!live) return
        const active = next.accounts.find((a) => a.id === next.activeAccountId)
        if (active) setAccount(active)
        else onSkip()
      })
      .catch(() => live && onSkip())
    return () => {
      live = false
    }
    // Once, on arrival: onSkip is a new function on every render of the wizard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!account) return null

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.opencat.voice.set(account.id, {
        description: description.trim(),
        language,
        images
      })
      onNext()
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  const addStarter = (phrase: string): void => {
    const current = description.trim()
    setDescription(current ? `${current} ${phrase}` : phrase)
  }

  return (
    <StepPage
      step="voice"
      title="How should your posts sound?"
      lead={`Tell the agent how @${account.handle} posts, in your own words. It's a starting point: you can change it any time in Settings, or skip it and the agent will ask you a few questions instead.`}
      onSubmit={() => void save()}
      actions={
        <>
          <BackButton onClick={onBack} />
          {spacer}
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-[12px] text-ds-text-3 hover:text-ds-text-2"
            onClick={onNext}
          >
            Skip for now
          </button>
          <NextButton label="Save and continue" submit disabled={busy} />
        </>
      }
    >
      <div className={`${box} flex flex-col divide-y divide-ds-border`}>
        <div className="flex flex-col gap-2.5 px-[18px] py-[14px]">
          <label htmlFor={descriptionId} className="text-[13px] font-medium">
            In a sentence or two
          </label>
          <textarea
            id={descriptionId}
            className="box-border min-h-[96px] w-full resize-y rounded-lg border border-ds-border-strong bg-ds-inset px-3 py-2.5 font-sans text-[13px] leading-[1.5] text-ds-text outline-none placeholder:text-ds-text-3 focus:border-ds-accent"
            placeholder="e.g. Friendly and direct. Short sentences. Talk to other founders, not to investors."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {STARTERS.map((s) => (
              <button
                key={s.label}
                type="button"
                aria-label={`Add ${s.label}`}
                className="box-border h-[26px] cursor-pointer rounded-full border border-ds-border-strong bg-transparent px-2.5 text-[12px] text-ds-text-2 hover:text-ds-text"
                onClick={() => addStarter(s.phrase)}
              >
                + {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className={ROW}>
          <label htmlFor={languageId} className="flex-1 text-[13px] font-medium">
            Language
          </label>
          <Select id={languageId} value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </Select>
        </div>
        <div className={ROW}>
          <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span id={imagesId} className="text-[13px] font-medium">
              Images with posts
            </span>
            <span id={imagesSubId} className="text-[12px] text-ds-text-3">
              Whether the agent designs an image for a post
            </span>
          </span>
          <Segmented role="group" aria-labelledby={imagesId} aria-describedby={imagesSubId}>
            {IMAGE_CHOICES.map((c) => (
              <SegmentedItem
                key={c.value}
                aria-pressed={images === c.value}
                onClick={() => setImages(c.value)}
              >
                {c.label}
              </SegmentedItem>
            ))}
          </Segmented>
        </div>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
    </StepPage>
  )
}
