import type { PostsToolResult, RenderToolResult, ToolResult } from './api'

/** The posts a tool message is about, or null when it is some other tool result. */
export function parsePostsToolResult(content: string): PostsToolResult | null {
  try {
    const value = JSON.parse(content) as Partial<PostsToolResult>
    if (value.kind === 'posts' && Array.isArray(value.postIds) && value.action) {
      return value as PostsToolResult
    }
  } catch {
    // Not JSON: not a result we draw.
  }
  return null
}

/** Any tool result the chat draws: posts touched, or an image rendered. */
export function parseToolResult(content: string): ToolResult | null {
  const posts = parsePostsToolResult(content)
  if (posts) return posts
  try {
    const value = JSON.parse(content) as Partial<RenderToolResult>
    if (
      value.kind === 'render' &&
      typeof value.mediaId === 'string' &&
      typeof value.width === 'number' &&
      typeof value.height === 'number' &&
      typeof value.url === 'string'
    ) {
      return value as RenderToolResult
    }
  } catch {
    // Not JSON.
  }
  return null
}

/** What the model reads back about an earlier tool call, in the saved history. */
export function toolNote(result: ToolResult): string {
  return result.kind === 'posts'
    ? `(Tool note, already done: ${result.action} posts ${result.postIds.join(', ')}.)`
    : `(Tool note, already done: rendered image media id ${result.mediaId}, ${result.width}x${result.height}. It can be attached by that id.)`
}
