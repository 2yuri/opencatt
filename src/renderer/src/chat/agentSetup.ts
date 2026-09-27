export const INSTALL_URL = 'https://claude.com/claude-code'
export const LOGIN_COMMAND = 'claude login'

/** "max" → "Max plan". */
export const planName = (plan: string): string =>
  `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`
