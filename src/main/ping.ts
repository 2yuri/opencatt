import type { PingResult } from '@shared/api'

export function ping(electron: string, platform: string): PingResult {
  return { message: 'pong', electron, platform }
}
