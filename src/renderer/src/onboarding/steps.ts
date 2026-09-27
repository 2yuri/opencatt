import { X_CALLBACK_URL, XLinks } from '@shared/x'

export interface CopyValue {
  label: string
  value: string
}

export interface PortalStep {
  id: string
  title: string
  detail: string
  link?: { label: string; url: string }
  copy?: CopyValue[]
}

// X has no API for creating developer apps, so this is a checklist of what to click in the console.
// Keep the wording close to X's labels; when X renames something, this is the only place to fix.
export const portalSteps: PortalStep[] = [
  {
    id: 'console',
    title: 'Sign in to the X Developer Console',
    detail: 'Use the X account you want OpenCatt to post as. Accept the developer terms if X asks.',
    link: { label: 'Open the console', url: XLinks.console }
  },
  {
    id: 'project',
    title: "Check your project's plan",
    detail:
      'Open "Projects": each project shows its plan, like "My project · Pay Per Use". Posting needs Pay Per Use or higher; the Free plan can\'t post.',
    link: { label: "X's pricing", url: XLinks.pricing }
  },
  {
    id: 'app',
    title: 'Create an app',
    detail:
      'Open "Apps" and click "Create App". In "Create New Client Application", any name works, for example "OpenCatt for yourname". Under Project Access, tick your Pay Per Use project, then Create.',
    link: { label: 'Open the console', url: XLinks.console }
  },
  {
    id: 'secrets',
    title: 'Keep the keys X shows you to yourself',
    detail:
      "X shows a Consumer Key, Consumer Secret and Bearer Token once, right after you create the app. Never share them, and paste them only into OpenCatt. The usual sign-in below doesn't need them."
  },
  {
    id: 'oauth2-setup',
    title: "Open the app's authentication settings",
    detail:
      'On the app\'s page, click "Settings" (on a brand-new app it can be "Setup" under OAuth 2.0 Keys). This is where X asks how OpenCatt signs in as you.',
    link: { label: 'How X explains it', url: XLinks.appsGuide }
  },
  {
    id: 'permissions',
    title: 'Set App permissions to "Read and write"',
    detail: 'Read only is not enough: OpenCatt needs to publish posts for you.'
  },
  {
    id: 'type',
    title: 'Set Type of App to "Native App"',
    detail:
      'Native App means a desktop app. It needs no client secret, so there is none to paste here.'
  },
  {
    id: 'urls',
    title: 'Paste the Callback URI and a Website URL',
    detail:
      'Paste it into "Callback URI / Redirect URL"; it must match exactly. For the Website URL, your profile link such as https://x.com/yourname is fine. Then save.',
    copy: [{ label: 'Callback URI', value: X_CALLBACK_URL }]
  },
  {
    id: 'client-id',
    title: 'Copy the Client ID',
    detail:
      'Open the app\'s "Keys & Tokens" tab and copy the Client ID under "OAuth 2.0 Keys". You paste it on the next screen. It isn\'t secret.'
  }
]

/** The wizard's seven steps, as the rail lists them. */
export const wizardSteps = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'portal', label: 'Create your X app' },
  { id: 'credentials', label: 'Paste your Client ID' },
  { id: 'connect', label: 'Connect your account' },
  { id: 'voice', label: 'How your posts sound' },
  { id: 'agent', label: 'Set up the agent' },
  { id: 'login', label: 'Keep posts on time' }
] as const

export type WizardStep = (typeof wizardSteps)[number]['id']
