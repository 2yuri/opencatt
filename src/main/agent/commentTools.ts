import type { Comment } from '@shared/api'
import type { CommentsService } from '../comments/service'
import {
  ToolInputError,
  futureTime,
  localIso,
  object,
  postText,
  string,
  type PostTool,
  type ToolAccounts,
  type ToolCaller
} from './tools'

const MAX_LISTED = 50

/**
 * The comments tools (OP-124), for the in-app agent and MCP clients. They only see what the last
 * refresh on the Interactions page stored: reading from X costs money, so only the user starts it.
 * A reply is a post answering the comment, and like every agent post it waits for the user's
 * approval unless the account has Autopilot on.
 */
export function commentTools(
  comments: CommentsService,
  now: () => Date = () => new Date(),
  by: ToolCaller = 'agent',
  accounts: ToolAccounts = { forCall: () => null }
): PostTool[] {
  const accountParam = accounts.named
    ? {
        account: {
          type: 'string',
          description:
            'The X account, by handle, like @opencatt. Leave it out for the account active in ' +
            'OpenCatt.'
        }
      }
    : {}
  // Another platform's account gets the plain reason, not an empty list or "no comment".
  const onX = (account: string): void => {
    try {
      comments.xAccount(account)
    } catch (err) {
      throw new ToolInputError(err instanceof Error ? err.message : String(err))
    }
  }
  const describe = (c: Comment): Record<string, unknown> => ({
    id: c.remoteId,
    from: `@${c.author.handle}`,
    ...(c.author.name ? { name: c.author.name } : {}),
    text: c.text,
    at: localIso(new Date(c.createdAt)),
    url: c.url,
    new: c.readAt === null,
    ...(c.answer
      ? {
          answered: {
            post_id: c.answer.postId,
            status: c.answer.status,
            at: localIso(new Date(c.answer.scheduledAt))
          }
        }
      : {})
  })

  return [
    {
      name: 'list_comments',
      description:
        "List replies people left on the account's X posts, newest first, as of the user's last " +
        'refresh on the Interactions page. This never reads from X, which charges for reads; if ' +
        'the list looks old, ask the user to refresh it there. Unanswered ones have no "answered".',
      inputSchema: {
        type: 'object',
        properties: {
          ...accountParam,
          unanswered_only: {
            type: 'boolean',
            description: 'Only comments nobody has answered yet. Default false.'
          }
        },
        required: [],
        additionalProperties: false
      },
      run(input) {
        const args = object(input)
        const account = accounts.forCall(args)
        if (!account) throw new ToolInputError('No X account is connected yet.')
        onX(account)
        const only = args['unanswered_only'] === true
        const list = comments.list(account).filter((c) => !only || !c.answer)
        const last = comments.lastRefresh()
        return {
          content: JSON.stringify({
            comments: list.slice(0, MAX_LISTED).map(describe),
            ...(list.length > MAX_LISTED ? { more: list.length - MAX_LISTED } : {}),
            refreshed_at: last ? localIso(new Date(last.at)) : null
          })
        }
      }
    },
    {
      name: 'reply_to_comment',
      description:
        'Reply on X to one comment from list_comments, by its id. The reply is a post answering ' +
        "it and follows X's 280-character count. It waits for the user's approval in OpenCatt, " +
        'unless the account has Autopilot on, and goes out at scheduled_at. Without scheduled_at ' +
        'it is due now: it goes out once approved, and if the user approves it more than an ' +
        "hour later they pick a new time. Write it in the account's voice.",
      inputSchema: {
        type: 'object',
        properties: {
          ...accountParam,
          comment_id: { type: 'string', description: 'The id list_comments gave.' },
          text: { type: 'string', description: 'The reply.' },
          scheduled_at: {
            type: 'string',
            description: "Optional ISO time with the user's UTC offset, in the future."
          }
        },
        required: ['comment_id', 'text'],
        additionalProperties: false
      },
      run(input) {
        const args = object(input)
        const account = accounts.forCall(args)
        if (!account) throw new ToolInputError('No X account is connected yet.')
        onX(account)
        const id = string(args['comment_id'], 'comment_id')
        const text = postText(args['text'], 'text')
        const at =
          args['scheduled_at'] === undefined
            ? now()
            : futureTime(args['scheduled_at'], 'scheduled_at', now())
        if (!comments.get(id, account)) {
          throw new ToolInputError(`No comment with id ${id}. Use list_comments to find it.`)
        }
        let post
        try {
          post = comments.reply(id, { text, scheduledAt: at.toISOString() }, by, account)
        } catch (err) {
          throw new ToolInputError(err instanceof Error ? err.message : String(err))
        }
        return {
          content: JSON.stringify({
            reply: {
              post_id: post.id,
              to: id,
              status:
                post.status === 'scheduled' && post.autopilot
                  ? 'scheduled (Autopilot on)'
                  : post.status,
              at: localIso(new Date(post.scheduledAt))
            },
            ...(post.status === 'pending_approval'
              ? {
                  note: "Waiting for the user's approval in OpenCatt. It won't be posted until they approve it."
                }
              : {})
          }),
          result: { kind: 'posts', action: 'created', postIds: [post.id] }
        }
      }
    }
  ]
}
