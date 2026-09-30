import { useRef, useState } from 'react'
import type { XAccount } from '@shared/api'
import { Switch } from '../ui'
import { AutopilotConfirm } from './AutopilotConfirm'
import type { Autopilot } from './useAutopilot'

/**
 * The Autopilot switch (OP-104): turning it on asks first, turning it off doesn't. The caller
 * holds `autopilot`, so it can show the error and the badge where its design puts them.
 */
export function AutopilotSwitch({
  account,
  autopilot,
  size,
  ...labels
}: {
  account: XAccount
  autopilot: Autopilot
  size?: 'md' | 'sm'
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-label'?: string
}): React.JSX.Element {
  const [asking, setAsking] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const on = autopilot.on ?? false

  const done = (): void => {
    setAsking(false)
    ref.current?.querySelector('button')?.focus()
  }

  return (
    <span ref={ref} className="flex shrink-0">
      <Switch
        checked={on}
        size={size}
        disabled={autopilot.on === null || autopilot.pending}
        onClick={() => (on ? void autopilot.set(false) : setAsking(true))}
        {...labels}
      />
      {asking && (
        <AutopilotConfirm
          handle={account.handle}
          onCancel={done}
          onConfirm={() => {
            done()
            void autopilot.set(true)
          }}
        />
      )}
    </span>
  )
}
