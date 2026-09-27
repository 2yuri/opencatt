import { useState } from 'react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import type { OnboardingStatus } from '@shared/api'
import {
  clientIdError,
  oauth1KeysErrors,
  trimKeys,
  type OAuth1Keys,
  type OAuth1KeysErrors
} from '@shared/x'
import { box, linkButton, messageOf, spacer } from '../helpers'
import { BackButton, ErrorBox, NextButton, StepPage } from '../shared'

const inputClass =
  'box-border h-[40px] w-full rounded-[9px] border-0 bg-ds-inset px-[12px] font-mono text-[13px] text-ds-text outline-1 -outline-offset-1 outline-ds-border-strong focus:outline-[1.5px] focus:outline-ds-accent aria-invalid:outline-ds-red disabled:opacity-50'

function ErrorLine({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="m-0 flex items-center gap-[6px] text-[12px] text-ds-red" role="alert">
      <CircleAlert size={14} className="shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}

const emptyKeys: OAuth1Keys = {
  apiKey: '',
  apiKeySecret: '',
  accessToken: '',
  accessTokenSecret: ''
}

const keyFields: { field: keyof OAuth1Keys; label: string }[] = [
  { field: 'apiKey', label: 'Consumer Key (API Key)' },
  { field: 'apiKeySecret', label: 'Consumer Secret (API Key Secret)' },
  { field: 'accessToken', label: 'Access Token' },
  { field: 'accessTokenSecret', label: 'Access Token Secret' }
]

export function Credentials({
  status,
  onBack,
  onSaved
}: {
  status: OnboardingStatus
  onBack: () => void
  onSaved: (status: OnboardingStatus) => void
}): React.JSX.Element {
  const [mode, setMode] = useState(status.authMode ?? 'oauth2')
  const [clientId, setClientId] = useState(status.clientId ?? '')
  const [touched, setTouched] = useState(false)
  const [keys, setKeys] = useState<OAuth1Keys>(emptyKeys)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const idError = clientIdError(clientId.trim())
  const keyErrors: OAuth1KeysErrors = oauth1KeysErrors(trimKeys(keys))
  const valid = mode === 'oauth2' ? idError === null : Object.keys(keyErrors).length === 0

  const save = async (): Promise<void> => {
    setSaving(true)
    setServerError(null)
    try {
      const next =
        mode === 'oauth2'
          ? await window.opencat.onboarding.saveClientId(clientId.trim())
          : await window.opencat.onboarding.saveOAuth1Keys(trimKeys(keys))
      onSaved(next)
    } catch (err) {
      setServerError(messageOf(err))
    } finally {
      setSaving(false)
    }
  }

  const actions = (
    <>
      <BackButton onClick={onBack} />
      {spacer}
      <NextButton submit disabled={!valid || saving} />
    </>
  )
  const submit = (): void => {
    if (valid && !saving) void save()
  }

  if (mode === 'oauth2') {
    return (
      <StepPage
        step="credentials"
        title="Paste your Client ID"
        lead="From your app's “Keys & Tokens” tab, under “OAuth 2.0 Keys”. It isn't secret; you sign in on the next step."
        actions={actions}
        onSubmit={submit}
      >
        <div className="flex flex-col gap-[8px]">
          <label className="flex flex-col gap-[8px]">
            <span className="text-[13px] font-semibold">OAuth 2.0 Client ID</span>
            <input
              className={inputClass}
              value={clientId}
              autoFocus
              spellCheck={false}
              onChange={(e) => {
                setClientId(e.target.value)
                setTouched(true)
              }}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && idError !== null}
            />
          </label>
          {touched && idError ? (
            <ErrorLine>{idError}</ErrorLine>
          ) : (
            idError === null && (
              <p className="m-0 flex items-center gap-[6px] text-[12px] text-ds-green">
                <CircleCheck size={14} aria-hidden="true" />
                Looks like a Client ID
              </p>
            )
          )}
        </div>
        <div className={`${box} flex flex-col gap-[6px] p-[16px]`}>
          <strong className="text-[13px] font-semibold">Stuck on OAuth 2.0?</strong>
          <p className="m-0 text-[13px] leading-[20px] text-ds-text-2">
            Paste the four OAuth 1.0a keys instead: the Consumer Key and Secret X showed when you
            created the app, plus an Access Token and Secret. Generate the tokens after setting
            “Read and write”, or they can&apos;t post.
          </p>
          <button
            type="button"
            className={`${linkButton} self-start text-[13px] font-semibold`}
            onClick={() => setMode('oauth1')}
          >
            Paste keys instead <span aria-hidden="true">→</span>
          </button>
        </div>
        {serverError && <ErrorBox>{serverError}</ErrorBox>}
      </StepPage>
    )
  }

  return (
    <StepPage
      step="credentials"
      title="Paste your keys"
      lead="Use the Consumer Key and Secret X showed when you created the app. In the app's “Settings”, check that App permissions say “Read and write” first. Then, on the “Keys & Tokens” tab under “OAuth 1.0 Keys”, generate the Access Token and Secret: tokens made while the app was read only can't post. Paste these only into OpenCatt, never anywhere else."
      actions={actions}
      onSubmit={submit}
    >
      {!status.secureStorage && (
        <ErrorBox>
          Your system has no keyring to keep these keys safe. Install and unlock GNOME Keyring or
          KWallet and restart OpenCatt, or use the Client ID instead.
        </ErrorBox>
      )}
      <div className="flex flex-col gap-[14px]">
        {keyFields.map(({ field, label }) => (
          <div key={field} className="flex flex-col gap-[8px]">
            <label className="flex flex-col gap-[8px]">
              <span className="text-[13px] font-semibold">{label}</span>
              <input
                className={inputClass}
                type="password"
                value={keys[field]}
                spellCheck={false}
                autoComplete="off"
                disabled={!status.secureStorage}
                aria-invalid={keys[field] !== '' && keyErrors[field] !== undefined}
                onChange={(e) => setKeys({ ...keys, [field]: e.target.value })}
              />
            </label>
            {keys[field] !== '' && keyErrors[field] && <ErrorLine>{keyErrors[field]}</ErrorLine>}
          </div>
        ))}
      </div>
      <button
        type="button"
        className={`${linkButton} self-start text-[13px] font-semibold`}
        onClick={() => setMode('oauth2')}
      >
        Use the Client ID instead
      </button>
      {serverError && <ErrorBox>{serverError}</ErrorBox>}
    </StepPage>
  )
}
