import type { NewPartMedia, NewPostPart, Post, PostAuthor, ToolResult } from '@shared/api'
import type { ModelImage } from './images'
import { PostRuleError, type PostsService } from '../db'
import { PLATFORM_RULES, textLength, type PlatformRules } from '@shared/platforms'
import { startOfLocalDay } from '../db/dates'

// Each call follows its account's platform (OP-122); these are only the schema's outer bounds.
const X = PLATFORM_RULES.x
const TIKTOK = PLATFORM_RULES.tiktok
const MAX_PARTS = Math.max(...Object.values(PLATFORM_RULES).map((r) => r.maxParts))

const MAX_CREATE = 10
const MAX_LIST_DAYS = 62
/** A time the model just computed may be a few seconds behind; anything older is in the past. */
const PAST_SLACK_MS = 60_000

/** A JSON Schema object, as every provider's tool format takes it. */
export interface JsonSchema {
  type: 'object'
  properties: Record<string, unknown>
  required: string[]
  additionalProperties: false
}

export interface ToolOutcome {
  /** What the model reads back, as JSON. */
  content: string
  /** An image the model sees with the result, like a render it can check and redo. */
  image?: ModelImage
  /** What it made, for the chat cards. */
  result?: ToolResult
}

/** A tool described without any provider's types, so the Anthropic runner and MCP share it. */
export interface PostTool {
  name: string
  description: string
  inputSchema: JsonSchema
  run(input: unknown): ToolOutcome | Promise<ToolOutcome>
}

/** Bad input from the model. Returned to it as an error result so it can fix the call. */
export class ToolInputError extends Error {
  override name = 'ToolInputError'
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/

export function object(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ToolInputError('Input must be an object')
  }
  return input as Record<string, unknown>
}

export function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(`${field} must be a non-empty string`)
  }
  return value
}

export function postText(
  value: unknown,
  field: string,
  optional = false,
  rules: PlatformRules = X
): string {
  if (optional && (value === undefined || value === '')) return ''
  const text = string(value, field).trim()
  // The same count PostsService enforces for the platform (on X a link is 23, an emoji 2),
  // checked up front so a batch is refused whole rather than half created.
  const length = textLength(rules, text)
  if (length > rules.maxText) {
    throw new ToolInputError(
      `${field} counts ${length} of ${rules.name}'s ${rules.maxText} characters. Shorten it.`
    )
  }
  return text
}

const noMedia = (): ReadonlySet<string> => new Set()

/** A connected X account, as a tool call may name it. */
export interface ToolAccount {
  id: string
  handle: string
  name: string | null
  /** The platform it is on (OP-118); X when left out. */
  platform?: string
}

/**
 * Which X account a tool call acts in (OP-61). The in-app agent's tools act in the account of the
 * turn; an MCP client may name one by handle (`named`) and otherwise gets the active one. Null
 * means no account is connected yet, and nothing is scoped.
 */
export interface ToolAccounts {
  forCall(args: Record<string, unknown>): string | null
  /** MCP only: the accounts a call may name, which adds the `account` parameter. */
  named?: () => ToolAccount[]
  /** The rules the call's account follows (OP-122); X's when left out or there is no account. */
  rules?: (accountId: string | null) => PlatformRules
  /**
   * In-app agent only: the media ids on the user's message the running turn answers (OP-89). A
   * create or update that leaves one of them off every post says so in its result.
   */
  attached?: () => readonly string[]
}

const NO_ACCOUNTS: ToolAccounts = { forCall: () => null }

const bare = (handle: string): string => handle.trim().replace(/^@/, '').toLowerCase()

/** For MCP clients: `account` names one by handle, and leaving it out means the active one. */
export function namedAccounts(
  list: () => ToolAccount[],
  active: () => string | null,
  rules?: (accountId: string | null) => PlatformRules
): ToolAccounts {
  return {
    named: list,
    ...(rules ? { rules } : {}),
    forCall(args) {
      const handle = args['account']
      if (handle === undefined) return active()
      if (typeof handle !== 'string' || bare(handle) === '') {
        throw new ToolInputError('account must be a handle like @opencatt')
      }
      const accounts = list()
      const found = accounts.find((a) => bare(a.handle) === bare(handle))
      if (found) return found.id
      const connected = accounts.map((a) => `@${a.handle}`).join(', ')
      throw new ToolInputError(
        `No connected account ${handle.startsWith('@') ? handle : `@${handle}`}. ` +
          (connected ? `Connected: ${connected}.` : 'No account is connected yet.')
      )
    }
  }
}

/**
 * `text` for a single post, or `parts` for a thread or a post with media. Every media id must be
 * one the user gave in this conversation (`allowed`) or already on the post being changed (`kept`).
 */
function partsInput(
  item: Record<string, unknown>,
  field: string,
  allowed: ReadonlySet<string>,
  kept: ReadonlySet<string> = new Set(),
  rules: PlatformRules = X
): NewPostPart[] {
  const hasText = item['text'] !== undefined
  const hasParts = item['parts'] !== undefined
  if (hasText === hasParts) throw new ToolInputError(`${field}: give either text or parts`)
  if (hasText) {
    if (!rules.textOnly) throw new ToolInputError(`${field}: ${needsVideo(rules)}`)
    return [{ text: postText(item['text'], `${field}.text`, false, rules) }]
  }

  const list = item['parts']
  if (!Array.isArray(list) || list.length === 0) {
    throw new ToolInputError(`${field}.parts must be a non-empty array`)
  }
  if (list.length > rules.maxParts) {
    throw new ToolInputError(
      rules.maxParts === 1
        ? `${field}.parts: a ${rules.name} post can't be a thread. Give one part: the video and its ${rules.textName}.`
        : `${field}.parts: a thread can have at most ${rules.maxParts} posts`
    )
  }
  return list.map((raw, i) => {
    const part = object(raw)
    const where = `${field}.parts[${i}]`
    const media = mediaInput(part['media'], `${where}.media`, allowed, kept)
    if (rules.videoRequired && media.length === 0) {
      throw new ToolInputError(`${where}: ${needsVideo(rules)}`)
    }
    const text = postText(part['text'], `${where}.text`, media.length > 0, rules)
    return { text, media }
  })
}

/** What to tell the model when a post on a video-only platform has none. */
function needsVideo(rules: PlatformRules): string {
  return (
    `a ${rules.name} post needs a video. Make one with render_video (it records at ` +
    `${rules.video.renderSize.width}x${rules.video.renderSize.height} for this account), or ` +
    'use a video the user attached, then give it in parts[0].media with the ' +
    `${rules.textName} as parts[0].text.`
  )
}

/** What the post tools' descriptions say about platforms other than X. */
const PLATFORM_NOTE =
  ` On a ${TIKTOK.name} account a post is one video with a ${TIKTOK.textName} of up to ` +
  `${TIKTOK.maxText} characters, hashtags included in the ${TIKTOK.textName}: give it as parts ` +
  `with one part whose media is the video. ${TIKTOK.name} takes no text-only posts, no threads, ` +
  'no images and no GIFs. list_posts says which platform the account is on.'

function mediaInput(
  value: unknown,
  field: string,
  allowed: ReadonlySet<string>,
  kept: ReadonlySet<string>
): NewPartMedia[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new ToolInputError(`${field} must be an array`)
  return value.map((raw, i) => {
    const m = object(raw)
    const id = string(m['id'], `${field}[${i}].id`)
    if (!allowed.has(id) && !kept.has(id)) {
      throw new ToolInputError(
        `${field}[${i}]: ${id} isn't a file the user attached in this chat. Use only the media ids ` +
          'shown on their messages.'
      )
    }
    const alt = m['alt']
    if (alt !== undefined && typeof alt !== 'string') {
      throw new ToolInputError(`${field}[${i}].alt must be a string`)
    }
    return { id, alt: alt ?? null }
  })
}

const mediaIdsOf = (parts: NewPostPart[]): string[] =>
  parts.flatMap((part) => (part.media ?? []).map((m) => m.id))

/**
 * Each file can be on one post. Refuses a file used twice in the call, or one already on a post
 * other than `own` (the post being edited), naming the post that holds it.
 */
function assertMediaFree(ids: string[], posts: PostsService, own?: string): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) {
      throw new ToolInputError(`${id} is used twice in this call; each file can be on one post.`)
    }
    seen.add(id)
    const holder = posts.withMedia(id)
    if (holder && holder.id !== own) {
      throw new ToolInputError(
        `${id} is already on post ${holder.id}; each file can be on one post.`
      )
    }
  }
}

export function futureTime(value: unknown, field: string, now: Date): Date {
  const text = string(value, field)
  if (!ISO_WITH_OFFSET.test(text)) {
    throw new ToolInputError(
      `${field} must be an ISO time with an offset, like 2026-09-28T09:00:00+01:00`
    )
  }
  const at = new Date(text)
  if (Number.isNaN(at.getTime())) throw new ToolInputError(`${field} is not a real time`)
  if (at.getTime() < now.getTime() - PAST_SLACK_MS) {
    throw new ToolInputError(`${field} is in the past; it is now ${localIso(now)}`)
  }
  return at
}

function localDate(value: unknown, field: string): string {
  const text = string(value, field)
  if (!LOCAL_DATE.test(text)) throw new ToolInputError(`${field} must be a date like 2026-09-28`)
  try {
    startOfLocalDay(text)
  } catch {
    throw new ToolInputError(`${field} is not a real date`)
  }
  return text
}

/** 2026-09-28T09:00:00+01:00: the user's wall clock, with the offset that makes it exact. */
export function localIso(at: Date): string {
  const pad = (n: number): string => String(Math.abs(n)).padStart(2, '0')
  const offset = -at.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  )
}

const WEEKDAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' })

function describe(post: Post): Record<string, unknown> {
  const at = new Date(post.scheduledAt)
  const plain = post.parts.length === 1 && post.parts[0].media.length === 0
  return {
    id: post.id,
    text: post.text,
    ...(plain
      ? {}
      : {
          parts: post.parts.map((part) => ({
            text: part.text,
            ...(part.media.length
              ? {
                  media: part.media.map((m) => ({
                    id: m.id,
                    kind: m.kind,
                    ...(m.alt ? { alt: m.alt } : {})
                  }))
                }
              : {})
          }))
        }),
    scheduled_at: localIso(at),
    weekday: WEEKDAY.format(at),
    status:
      post.status === 'scheduled' && post.autopilot ? 'scheduled (Autopilot on)' : post.status,
    ...(post.status === 'pending_approval'
      ? {
          note: "Waiting for the user's approval in OpenCatt. It won't be posted until they approve it."
        }
      : post.status === 'scheduled' && post.autopilot
        ? {
            note: "Autopilot is on for this account, so it's scheduled without the user's approval and goes out at its time. They can still edit or delete it in OpenCatt."
          }
        : {}),
    ...(post.error ? { error: post.error } : {}),
    ...(post.remoteUrl ? { url: post.remoteUrl } : {})
  }
}

function days(from: string, to: string): string[] {
  const start = startOfLocalDay(from)
  const end = startOfLocalDay(to)
  if (end < start) throw new ToolInputError('to must be on or after from')
  const list: string[] = []
  for (let d = start; d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    list.push(localIso(d).slice(0, 10))
    if (list.length > MAX_LIST_DAYS) {
      throw new ToolInputError(`List at most ${MAX_LIST_DAYS} days at a time`)
    }
  }
  return list
}

const json = (value: unknown): string => JSON.stringify(value)

const PARTS_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: MAX_PARTS,
  description: 'A thread, first post first, or a single post with media.',
  items: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'May be empty when the part has media.' },
      media: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: "A media id from the user's message." },
            alt: { type: 'string', description: 'Alt text describing the image.' }
          },
          required: ['id'],
          additionalProperties: false
        }
      }
    },
    required: ['text'],
    additionalProperties: false
  }
}

/**
 * The scheduling tools. PostsService stays the only writer, so its rules (posted posts are
 * read-only, a failed post edited goes back to scheduled) hold for the agent too.
 */
/** Who the tools act for. Neither may approve: that is only ever the user, in the app. */
export type ToolCaller = Exclude<PostAuthor, 'user'>

export function postTools(
  posts: PostsService,
  now: () => Date = () => new Date(),
  by: ToolCaller = 'agent',
  /** Media ids the user gave in that account's conversation; MCP clients have none. */
  mediaAllowed: (accountId: string | null) => ReadonlySet<string> = noMedia,
  accounts: ToolAccounts = NO_ACCOUNTS
): PostTool[] {
  const rulesOf = (account: string | null): PlatformRules => accounts.rules?.(account) ?? X
  /** A post in the call's account. Another account's post is "not found", never shown. */
  const one = (id: unknown, account: string | null): Post => {
    const post = posts.get(string(id, 'id'))
    const elsewhere =
      post && account !== null && post.accountId !== null && post.accountId !== account
    if (!post || elsewhere) {
      throw new ToolInputError(`No post with id ${String(id)}. Use list_posts to find it.`)
    }
    return post
  }
  // MCP clients may name the account; the in-app agent always works in its turn's.
  const accountParam = accounts.named
    ? {
        account: {
          type: 'string',
          description:
            'The X account to act in, by handle, like @opencatt. Leave it out for the account ' +
            'active in OpenCatt. list_accounts shows the connected ones.'
        }
      }
    : {}

  /**
   * Files the user attached to this turn's message that no post carries, as a note for the result.
   * A nudge, not a refusal: the user may have said to replace them or use them as a reference.
   */
  const unplaced = (): Record<string, string> => {
    const missing = (accounts.attached?.() ?? []).filter((id) => !posts.withMedia(id))
    if (missing.length === 0) return {}
    return {
      attachment_note:
        `The user attached ${missing.join(', ')} to their message, and no post carries ` +
        `${missing.length === 1 ? 'it' : 'them'} yet. Their files go on the post as they are: ` +
        'add them with update_post, or in the post they are meant for, unless the user said to ' +
        'replace them or use them only as a reference.'
    }
  }

  return [
    {
      name: 'create_posts',
      description:
        `Draft one or more posts for the account (up to ${MAX_CREATE} per call). Each lands on the user's ` +
        'calendar waiting for their approval, and goes out at its time only after they approve ' +
        'it in OpenCatt, unless the account has Autopilot on: then it is scheduled straight ' +
        'away, and the result says "scheduled (Autopilot on)". Give text for a single post, or parts for a thread (each part is one ' +
        `post, replying to the one before, up to ${X.maxParts} on X) or a post with media. On X each part's ` +
        `text is at most ${X.maxText} characters as X counts them (a link counts 23, an ` +
        'emoji 2). Media is only files the user attached in this chat, by the id shown on their ' +
        'message, and a file they attached goes on the post as it is, not redrawn: up to 4 images, or 1 GIF, or 1 video per part, with alt text describing each ' +
        "image. Times are ISO with the user's UTC offset and must be in the future. All posts are " +
        'checked first; if one is invalid, none are created. A post whose first part has the ' +
        'same text and time as an existing one is not created again: it is reported under ' +
        'already_scheduled, or under already_rejected if the user turned it down.' +
        PLATFORM_NOTE,
      inputSchema: {
        type: 'object',
        properties: {
          ...accountParam,
          posts: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_CREATE,
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'The text of a single post without media.' },
                parts: PARTS_SCHEMA,
                scheduled_at: {
                  type: 'string',
                  description: 'When to post, e.g. 2026-09-28T09:00:00+01:00'
                }
              },
              required: ['scheduled_at'],
              additionalProperties: false
            }
          }
        },
        required: ['posts'],
        additionalProperties: false
      },
      run(input) {
        const args = object(input)
        const account = accounts.forCall(args)
        const list = args['posts']
        if (!Array.isArray(list) || list.length === 0) {
          throw new ToolInputError('posts must be a non-empty array')
        }
        if (list.length > MAX_CREATE) {
          throw new ToolInputError(`Create at most ${MAX_CREATE} posts per call`)
        }
        const at = now()
        const allowed = mediaAllowed(account)
        const rules = rulesOf(account)
        const valid = list.map((item, i) => {
          const post = object(item)
          return {
            parts: partsInput(post, `posts[${i}]`, allowed, undefined, rules),
            scheduledAt: futureTime(post['scheduled_at'], `posts[${i}].scheduled_at`, at)
          }
        })
        // A retry after an error may ask for posts that already exist. The same first part at
        // the same time is the same post, so it is reported instead of scheduled twice.
        const planned = valid.map((p) => {
          const iso = p.scheduledAt.toISOString()
          const twin = posts
            .listByDay(localIso(p.scheduledAt).slice(0, 10), account)
            .find((q) => q.scheduledAt === iso && q.text === p.parts[0].text)
          return { ...p, iso, twin }
        })
        // Files are checked for the whole batch before anything is created, so a file used twice
        // or already on a post never leaves the batch half made.
        assertMediaFree(
          planned.filter((p) => !p.twin).flatMap((p) => mediaIdsOf(p.parts)),
          posts
        )
        const created: Post[] = []
        const existing: Post[] = []
        const rejected: Post[] = []
        for (const p of planned) {
          if (p.twin?.status === 'rejected') rejected.push(p.twin)
          else if (p.twin) existing.push(p.twin)
          else {
            created.push(
              posts.create(
                { parts: p.parts, scheduledAt: p.iso, ...(account ? { accountId: account } : {}) },
                { by }
              )
            )
          }
        }
        return {
          content: json({
            created: created.map(describe),
            ...(existing.length ? { already_scheduled: existing.map(describe) } : {}),
            ...(rejected.length
              ? {
                  already_rejected: rejected.map(describe),
                  note:
                    'The user turned down a post with this text at this time. Write something ' +
                    'different rather than sending it again.'
                }
              : {}),
            ...unplaced()
          }),
          ...(created.length
            ? { result: { kind: 'posts', action: 'created', postIds: created.map((p) => p.id) } }
            : {})
        }
      }
    },
    {
      name: 'list_posts',
      description:
        'List posts scheduled, posting, posted or failed between two local dates, both ' +
        `inclusive, at most ${MAX_LIST_DAYS} days. Use it to find ids or free times.`,
      inputSchema: {
        type: 'object',
        properties: {
          ...accountParam,
          from: { type: 'string', description: 'First local date, e.g. 2026-09-28' },
          to: { type: 'string', description: 'Last local date, e.g. 2026-10-04' }
        },
        required: ['from', 'to'],
        additionalProperties: false
      },
      run(input) {
        const args = object(input)
        const account = accounts.forCall(args)
        const range = days(localDate(args['from'], 'from'), localDate(args['to'], 'to'))
        return {
          content: json({
            platform: rulesOf(account).name,
            posts: range.flatMap((d) => posts.listByDay(d, account)).map(describe)
          })
        }
      }
    },
    {
      name: 'update_post',
      description:
        'Change a post that is waiting for approval, scheduled or failed. Give text to replace ' +
        "only the first part's text (its media and the rest of a thread stay), or parts to " +
        'replace every part, the same way as in create_posts; media already on the post can be ' +
        'kept by its id. Posted posts cannot be changed. Any post you change waits for the ' +
        'user to approve it again.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string', description: "The first part's new text." },
          parts: PARTS_SCHEMA
        },
        required: ['id'],
        additionalProperties: false
      },
      run(input) {
        const args = object(input)
        const account = accounts.forCall(args)
        const current = one(args['id'], account)
        const kept = new Set(current.parts.flatMap((p) => p.media.map((m) => m.id)))
        const patch =
          args['parts'] === undefined && args['text'] !== undefined
            ? { text: postText(args['text'], 'text', false, rulesOf(account)) }
            : { parts: partsInput(args, 'post', mediaAllowed(account), kept, rulesOf(account)) }
        if (patch.parts) assertMediaFree(mediaIdsOf(patch.parts), posts, current.id)
        const post = posts.update(current.id, patch, { by })
        return {
          content: json({ updated: describe(post), ...unplaced() }),
          result: { kind: 'posts', action: 'updated', postIds: [post.id] }
        }
      }
    },
    {
      name: 'reschedule_post',
      description:
        'Move a post to a new future time. Any post you move waits for the user to approve it again.',
      inputSchema: {
        type: 'object',
        properties: {
          ...accountParam,
          id: { type: 'string' },
          scheduled_at: {
            type: 'string',
            description: 'The new time, e.g. 2026-09-28T09:00:00+01:00'
          }
        },
        required: ['id', 'scheduled_at'],
        additionalProperties: false
      },
      run(input) {
        const args = object(input)
        const id = one(args['id'], accounts.forCall(args)).id
        const at = futureTime(args['scheduled_at'], 'scheduled_at', now())
        const post = posts.reschedule(id, at.toISOString(), { by })
        return {
          content: json({ rescheduled: describe(post) }),
          result: { kind: 'posts', action: 'rescheduled', postIds: [post.id] }
        }
      }
    },
    {
      name: 'delete_post',
      description:
        'Delete a draft that is still waiting for approval. Posts the user has approved (scheduled ' +
        "or failed) are theirs: you can't delete them, so ask the user to do it on the day board.",
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false
      },
      run(input) {
        const args = object(input)
        const post = one(args['id'], accounts.forCall(args))
        if (post.status !== 'pending_approval') {
          throw new ToolInputError(
            `Post ${post.id} is ${post.status}. ${
              post.status === 'rejected' ? 'The user turned it down' : 'The user approved it'
            }, so only they can delete it. Ask them to do it on its day board.`
          )
        }
        posts.delete(post.id)
        return {
          content: json({ deleted: { id: post.id, text: post.text } }),
          result: { kind: 'posts', action: 'deleted', postIds: [post.id] }
        }
      }
    },
    ...(accounts.named ? [listAccountsTool(accounts.named, accounts)] : [])
  ]
}

function listAccountsTool(named: () => ToolAccount[], accounts: ToolAccounts): PostTool {
  return {
    name: 'list_accounts',
    description:
      'List the X accounts connected in OpenCatt, by handle. Pass one as `account` to the other ' +
      'tools to act in it; without it they act in the active account.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    run() {
      const active = accounts.forCall({})
      return {
        content: json({
          accounts: named().map((a) => ({
            handle: `@${a.handle}`,
            name: a.name,
            platform: PLATFORM_RULES[a.platform === 'tiktok' ? 'tiktok' : 'x'].name,
            active: a.id === active
          }))
        })
      }
    }
  }
}

type RunOutcome = ToolOutcome & { isError: boolean }

function failed(err: unknown): RunOutcome {
  if (err instanceof ToolInputError || err instanceof PostRuleError) {
    return { content: json({ error: err.message }), isError: true }
  }
  throw err
}

/**
 * Runs a tool by name. Mistakes the model can fix come back as errors, never as throws. Sync,
 * for tools that are; an async tool (render_image) goes through callTool.
 */
export function runTool(tools: PostTool[], name: string, input: unknown): RunOutcome {
  const tool = tools.find((t) => t.name === name)
  if (!tool) return { content: json({ error: `Unknown tool ${name}` }), isError: true }
  try {
    const outcome = tool.run(input)
    if (outcome instanceof Promise) throw new Error(`${name} is async; use callTool`)
    return { ...outcome, isError: false }
  } catch (err) {
    return failed(err)
  }
}

/** runTool for any tool, sync or async. What the runners and MCP servers use. */
export async function callTool(
  tools: PostTool[],
  name: string,
  input: unknown
): Promise<RunOutcome> {
  const tool = tools.find((t) => t.name === name)
  if (!tool) return { content: json({ error: `Unknown tool ${name}` }), isError: true }
  try {
    return { ...(await tool.run(input)), isError: false }
  } catch (err) {
    return failed(err)
  }
}
