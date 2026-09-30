import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MCP_PORT } from '@shared/mcp'
import { DEV_FOLDER, DEV_MCP_PORT, devUserData, mcpPortFor } from './devBuild'

describe('unpackaged builds keep apart from the installed app (OP-134)', () => {
  it('use their own data folder, or the one OPENCATT_USER_DATA names', () => {
    expect(devUserData('/AppData', {})).toBe(join('/AppData', 'OpenCatt Dev'))
    expect(devUserData('/AppData', { OPENCATT_USER_DATA: ' /tmp/branch ' })).toBe('/tmp/branch')
    expect(devUserData('/AppData', { OPENCATT_USER_DATA: '' })).toBe(join('/AppData', DEV_FOLDER))
  })

  it("never land in the release's folder or the pre-rename one, whatever the case", () => {
    for (const name of ['opencat', 'opencatt']) expect(DEV_FOLDER.toLowerCase()).not.toBe(name)
  })

  it('run the MCP server on their own port, so a dev build runs beside the installed app', () => {
    expect(mcpPortFor(true, { OPENCATT_MCP_PORT: '5000' })).toBe(MCP_PORT)
    expect(mcpPortFor(false, {})).toBe(DEV_MCP_PORT)
    expect(mcpPortFor(false, { OPENCATT_MCP_PORT: '48000' })).toBe(48000)
    expect(mcpPortFor(false, { OPENCATT_MCP_PORT: 'nope' })).toBe(DEV_MCP_PORT)
  })
})
