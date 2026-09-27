import { randomBytes } from 'node:crypto'
import type { ToolResult } from '@shared/api'
import { currentTimeTool, McpHttpServer, MCP_PATH } from '../../mcp/server'
import type { PostTool } from '../tools'

/** The name the CLI knows the server by; its tools arrive as mcp__opencat__<tool>. */
export const SERVER_NAME = 'opencat'

/**
 * OpenCatt's tools for the claude CLI agent: the full set, delete included, like the API agent.
 * It is separate from the "other agents" server: a random port, a token made at launch, and
 * nothing the user configures. Tool calls run in this process, so each one reports the posts
 * it touched straight to the chat turn that is running.
 */
export class AgentMcpEndpoint {
  private readonly token = randomBytes(32).toString('base64url')
  private readonly server: McpHttpServer
  private listener: ((result: ToolResult) => void) | null = null

  constructor(tools: PostTool[], now: () => Date = () => new Date()) {
    const reporting = [currentTimeTool(now), ...tools].map((tool): PostTool => ({
      ...tool,
      run: async (input) => {
        const outcome = await tool.run(input)
        if (outcome.result) this.listener?.(outcome.result)
        return outcome
      }
    }))
    this.server = new McpHttpServer({ tools: reporting, token: () => this.token, port: 0 })
  }

  /** Tool names as the CLI sees them, for --allowedTools. */
  static toolNames(tools: PostTool[]): string[] {
    return [currentTimeTool(), ...tools].map((t) => `mcp__${SERVER_NAME}__${t.name}`)
  }

  /** Starts on first use and keeps running while the app does. */
  async config(): Promise<{ mcpServers: Record<string, unknown> }> {
    if (!this.server.running) await this.server.start()
    return {
      mcpServers: {
        [SERVER_NAME]: {
          type: 'http',
          url: `http://127.0.0.1:${this.server.port}${MCP_PATH}`,
          headers: { Authorization: `Bearer ${this.token}` }
        }
      }
    }
  }

  /** Sends tool results to `listener` until the returned function is called. */
  listen(listener: (result: ToolResult) => void): () => void {
    this.listener = listener
    return () => {
      if (this.listener === listener) this.listener = null
    }
  }

  stop(): Promise<void> {
    return this.server.stop()
  }
}
