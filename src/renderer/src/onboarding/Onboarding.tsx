import { useState } from 'react'
import type { OnboardingStatus } from '@shared/api'
import { wizardSteps, type WizardStep } from './steps'
import type { SummaryLine } from './helpers'
import { StepsRail } from './StepsRail'
import { AgentStep } from './steps/Agent'
import { Connect } from './steps/Connect'
import { Credentials } from './steps/Credentials'
import { Portal } from './steps/Portal'
import { StartAtLogin } from './steps/StartAtLogin'
import { VoiceStep } from './steps/Voice'
import { Welcome } from './steps/Welcome'

interface Props {
  initial: OnboardingStatus
  onDone: (status: OnboardingStatus) => void
  /** Reopened from Settings: a way back to the app without finishing again. */
  onClose?: () => void
}

/**
 * The first-run wizard (design v2, "v2 · Onboarding 1–6", and OP-75's voice step): the steps
 * rail on the left and the current step in the card on the right.
 */
export function Onboarding({ initial, onDone, onClose }: Props): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>('welcome')
  const [status, setStatus] = useState(initial)
  const [ticked, setTicked] = useState<Record<string, boolean>>({})
  const [handle, setHandle] = useState<string | null>(null)
  const [agentLine, setAgentLine] = useState<SummaryLine | null>(null)
  // Which way the user last moved, so a step that skips itself carries on the same way.
  const [direction, setDirection] = useState(1)

  const index = wizardSteps.findIndex((s) => s.id === step)
  const go = (offset: number) => () => {
    setDirection(Math.sign(offset))
    setStep(wizardSteps[index + offset].id)
  }

  return (
    <div className="flex h-full min-h-0 bg-ds-bg text-ds-text">
      <StepsRail current={index} onClose={onClose} />
      <main className="flex min-w-0 flex-1 flex-col py-[10px] pr-[10px]">
        <div className="box-border flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[14px] border border-ds-border bg-ds-surface px-[96px] py-[64px] max-[1100px]:px-[48px]">
          {step === 'welcome' && <Welcome onNext={go(1)} />}
          {step === 'portal' && (
            <Portal ticked={ticked} onTick={setTicked} onBack={go(-1)} onNext={go(1)} />
          )}
          {step === 'credentials' && (
            <Credentials
              status={status}
              onBack={go(-1)}
              onSaved={(next) => {
                setStatus(next)
                go(1)()
              }}
            />
          )}
          {step === 'connect' && (
            <Connect
              status={status}
              handle={handle}
              onHandle={setHandle}
              onBack={go(-1)}
              onNext={go(1)}
            />
          )}
          {step === 'voice' && <VoiceStep onBack={go(-1)} onNext={go(1)} onSkip={go(direction)} />}
          {step === 'agent' && (
            <AgentStep
              onBack={go(-1)}
              onNext={(line) => {
                setAgentLine(line)
                go(1)()
              }}
            />
          )}
          {step === 'login' && (
            <StartAtLogin
              summary={[
                {
                  text:
                    status.authMode === 'oauth1'
                      ? 'X app created and keys saved'
                      : 'X app created and Client ID saved',
                  ok: true
                },
                ...(handle ? [{ text: `Posting as @${handle}`, ok: true }] : []),
                agentLine ?? { text: 'Set up the agent later from the chat panel', ok: false }
              ]}
              onBack={go(-1)}
              onDone={onDone}
            />
          )}
        </div>
      </main>
    </div>
  )
}
