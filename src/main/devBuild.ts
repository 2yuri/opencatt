import { join } from 'node:path'
import { MCP_PORT } from '@shared/mcp'

/**
 * Unpackaged builds (pnpm dev, a branch under test) keep apart from the installed OpenCatt
 * (OP-134): their own data folder, keychain name, single-instance lock and MCP port. Otherwise a
 * branch's newer migration upgrades the user's real database, which the installed release then
 * refuses to open, and the branch's publisher sends the user's due posts for real.
 */

/** The folder name, unlike "OpenCat" and "OpenCatt" in any case, as macOS folders ignore case. */
export const DEV_FOLDER = 'OpenCatt Dev'
/** The name safeStorage encrypts with in dev, so dev keys never share the release's keychain entry. */
export const DEV_APP_NAME = 'OpenCat Dev'
export const DEV_MCP_PORT = 47899

type Env = Record<string, string | undefined>

/** Where an unpackaged build keeps its data: $OPENCATT_USER_DATA, else …/OpenCatt Dev. */
export function devUserData(appData: string, env: Env): string {
  const custom = env['OPENCATT_USER_DATA']?.trim()
  return custom ? custom : join(appData, DEV_FOLDER)
}

/** The MCP server's port: the release's, or $OPENCATT_MCP_PORT / 47899 for an unpackaged build. */
export function mcpPortFor(packaged: boolean, env: Env): number {
  if (packaged) return MCP_PORT
  const custom = Number(env['OPENCATT_MCP_PORT'])
  return Number.isInteger(custom) && custom > 0 && custom < 65536 ? custom : DEV_MCP_PORT
}
