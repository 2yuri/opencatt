import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles.css'
import './tailwind.css'

// The traffic lights sit in the sidebar on macOS (hiddenInset title bar), so it leaves room.
document.documentElement.dataset['platform'] = navigator.userAgent.includes('Mac') ? 'mac' : 'other'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
