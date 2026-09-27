import { authErrorMessage } from '@shared/authErrors'
import { useRef, useState } from 'react'
import { CircleAlert, Info, LoaderCircle } from 'lucide-react'
import type { OnboardingStatus } from '@shared/api'
import { X_CALLBACK_URL } from '@shared/x'
import { box, linkButton, spacer } from '../helpers'
import { BackButton, ErrorBox, NextButton, StepPage } from '../shared'
import { Button } from '../../ui'

/**
 * OP-5's X sign-in. It isn't in OpenCatApi until that merges, so step 4 looks for it at run time
 * and explains itself when it is missing.
 */
interface XAuthApi {
  connect(): Promise<string | { handle: string }>
}

function xAuth(): XAuthApi | undefined {
  const auth = (window.opencat as { auth?: Partial<XAuthApi> }).auth
  return auth?.connect ? (auth as XAuthApi) : undefined
}

/** connect resolves the handle, bare or as { handle }; shown without its "@". */
function handleOf(result: string | { handle: string }): string {
  return (typeof result === 'string' ? result : result.handle).replace(/^@/, '')
}

const connectLead =
  'OpenCatt opens X in your browser. Sign in as the account you want to post as and allow access; you come straight back here.'

export function Connect({
  status,
  handle,
  onHandle,
  onBack,
  onNext
}: {
  status: OnboardingStatus
  handle: string | null
  onHandle: (handle: string) => void
  onBack: () => void
  onNext: () => void
}): React.JSX.Element {
  const auth = xAuth()
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Only the latest attempt counts: "Open X again" starts a new one.
  const attempt = useRef(0)

  const connect = async (api: XAuthApi): Promise<void> => {
    const mine = ++attempt.current
    setWaiting(true)
    setError(null)
    try {
      const result = await api.connect()
      if (mine === attempt.current) onHandle(handleOf(result))
    } catch (err) {
      if (mine === attempt.current) setError(authErrorMessage(err))
    } finally {
      if (mine === attempt.current) setWaiting(false)
    }
  }

  // Pasted OAuth 1.0a keys already belong to one account, and without OP-5 there is nothing to
  // sign in with; either way the step only says so.
  const note =
    status.authMode === 'oauth1'
      ? 'Your keys already let OpenCatt post as the account that made them, so there is nothing to connect here.'
      : !auth
        ? 'Signing in to X from here comes with the X sign-in update. Until then, OpenCatt uses the app you just set up.'
        : null

  const connected = auth && !note && handle !== null && !waiting

  return (
    <StepPage
      step="connect"
      title="Connect your X account"
      lead={connectLead}
      actions={
        <>
          <BackButton onClick={onBack} />
          {spacer}
          <NextButton disabled={!note && !connected} onClick={onNext} />
        </>
      }
    >
      {note || !auth ? (
        <p
          className={`${box} m-0 flex gap-[10px] p-[16px] text-[13px] leading-[20px] text-ds-text-2`}
        >
          <Info size={15} className="mt-[2px] shrink-0 text-ds-text-3" aria-hidden="true" />
          {note}
        </p>
      ) : connected ? (
        <div className="box-border flex items-center gap-[14px] rounded-[12px] bg-ds-raised p-[18px] outline-[1.5px] -outline-offset-[0.75px] outline-ds-green">
          <span
            aria-hidden="true"
            className="grid size-[44px] shrink-0 place-items-center rounded-full bg-[linear-gradient(-135deg,#60a5fa_14.645%,#2563eb_85.355%)] text-[18px] font-semibold text-white"
          >
            {handle.charAt(0).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <strong className="text-[14px] font-semibold">Connected as @{handle}</strong>
            <span className="text-[12px] leading-[19px] text-ds-text-2">
              The tokens are kept encrypted in your system keychain.
            </span>
          </span>
          <button
            type="button"
            className={`${linkButton} shrink-0 text-[12px]`}
            onClick={() => void connect(auth)}
          >
            Use another account
          </button>
        </div>
      ) : waiting ? (
        <div className={`${box} flex items-center gap-[12px] p-[14px]`}>
          <LoaderCircle
            size={18}
            className="shrink-0 animate-spin text-ds-accent-text"
            aria-hidden="true"
          />
          <span className="flex-1 text-[13px] leading-[20px]">
            Waiting for you to allow access in your browser…
          </span>
          <Button type="button" variant="secondary" onClick={() => void connect(auth)}>
            Open X again
          </Button>
        </div>
      ) : (
        <div className={`${box} flex items-center gap-[12px] p-[14px]`}>
          <span className="flex-1 text-[13px] leading-[20px] text-ds-text-2">
            Sign in on X to let OpenCatt post as you.
          </span>
          <Button type="button" variant="primary" onClick={() => void connect(auth)}>
            {error ? 'Try again' : 'Connect X account'}
          </Button>
        </div>
      )}
      {auth && !note && error && <ErrorBox>{error}</ErrorBox>}
      {auth && !note && !connected && (waiting || error) && (
        <p className="m-0 flex gap-[10px] rounded-[10px] bg-ds-amber-2 px-[12px] py-[10px] text-[12px] leading-[19px] text-ds-amber">
          <CircleAlert size={15} className="mt-[2px] shrink-0" aria-hidden="true" />
          <span>
            If X says the callback doesn&apos;t match, go back a step and check the Callback URI is
            exactly {X_CALLBACK_URL}.
          </span>
        </p>
      )}
    </StepPage>
  )
}
