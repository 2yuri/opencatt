import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import type { OnboardingStatus } from '@shared/api'
import { ApprovalsScreen } from './approvals/ApprovalsScreen'
import { CalendarScreen } from './calendar/CalendarScreen'
import { ChatPanel } from './chat/ChatPanel'
import { postRoute } from './chat/postRoute'
import { DayBoardScreen } from './day/DayBoardScreen'
import { EditorProvider } from './editor/EditorProvider'
import { IntegrationsScreen } from './integrations/IntegrationsScreen'
import { MediaViewerProvider } from './media/MediaViewer'
import { Onboarding } from './onboarding/Onboarding'
import { SettingsScreen } from './settings/SettingsScreen'
import { Sidebar } from './shell/Sidebar'

// Hash routing: the packaged app loads index.html from disk, where path URLs don't resolve.
export function App(): React.JSX.Element {
  return (
    <HashRouter>
      {/* Outside the editor, so a thumbnail in the editor opens the viewer over it (OP-88). */}
      <MediaViewerProvider>
        <EditorProvider>
          <FirstRunGate />
        </EditorProvider>
      </MediaViewerProvider>
    </HashRouter>
  )
}

/** Shows the onboarding wizard until the user has connected an X app, then the app itself. */
export function FirstRunGate(): React.JSX.Element {
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.opencat.onboarding
      .status()
      .then(setStatus)
      .catch((err: unknown) => setError(String(err)))
  }, [])

  if (error) return <p className="status error">{error}</p>
  if (!status) return <main className="app" aria-busy="true" />
  if (!status.complete) return <Onboarding initial={status} onDone={setStatus} />
  return <Shell setupStatus={status} onSetupDone={setStatus} />
}

/** The screens on the left, the chat with the agent on the right. */
export function Shell({
  setupStatus,
  onSetupDone
}: {
  setupStatus?: OnboardingStatus
  onSetupDone?: (status: OnboardingStatus) => void
}): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  // Reopened from Settings, the wizard takes the whole window, as on first run.
  if (setupStatus && location.pathname === '/setup') {
    return (
      <div className="h-screen">
        <Onboarding
          initial={setupStatus}
          onDone={(next) => {
            onSetupDone?.(next)
            void navigate('/')
          }}
          onClose={() => void navigate('/')}
        />
      </div>
    )
  }
  return (
    <div className="shell">
      <Sidebar connected={setupStatus?.complete ?? false} />
      <div className="main">
        <Routes>
          <Route path="*" element={<AppRoutes />} />
        </Routes>
      </div>
      <ChatPanel
        onOpenPost={(post) => void navigate(postRoute(post))}
        onOpenIntegrations={() => void navigate('/integrations')}
        onOpenVoice={() => void navigate('/settings#voice')}
      />
    </div>
  )
}

export function AppRoutes(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<CalendarScreen />} />
      <Route path="/day/:date" element={<DayBoardScreen />} />
      <Route path="/approvals" element={<ApprovalsScreen />} />
      <Route path="/integrations" element={<IntegrationsScreen />} />
      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
