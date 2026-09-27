// The contract between the renderer and the main process. Every IPC channel
// the renderer may call is named here, and the preload exposes exactly this.

import type { OAuth1Keys, XAuthMode } from './x'

export const IpcChannel = {
  Ping: 'app:ping',
  PostsCreate: 'posts:create',
  PostsGet: 'posts:get',
  PostsWithMedia: 'posts:withMedia',
  PostsListByDay: 'posts:listByDay',
  PostsCountsByDay: 'posts:countsByDay',
  PostsUpdate: 'posts:update',
  PostsReschedule: 'posts:reschedule',
  PostsDelete: 'posts:delete',
  PostsListRange: 'posts:listRange',
  PostsListPending: 'posts:listPending',
  PostsListByStatus: 'posts:listByStatus',
  PostsApprove: 'posts:approve',
  PostsReject: 'posts:reject',
  PostsPending: 'posts:pending',
  PostsPendingByAccount: 'posts:pendingByAccount',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  ChatList: 'chat:list',
  ChatClear: 'chat:clear',
  ChatSessionsList: 'chat:sessions:list',
  ChatSessionsCreate: 'chat:sessions:create',
  ChatSessionsRename: 'chat:sessions:rename',
  ChatSessionsDelete: 'chat:sessions:delete',
  ChatSessionsSetActive: 'chat:sessions:setActive',
  AgentSend: 'agent:send',
  AgentCapabilities: 'agent:capabilities',
  VideoPrePromptGet: 'video:prePrompt:get',
  VideoPrePromptSet: 'video:prePrompt:set',
  VideoPrePromptReset: 'video:prePrompt:reset',
  VoiceGet: 'voice:get',
  VoiceSet: 'voice:set',
  WritingPromptGet: 'voice:writingPrompt:get',
  WritingPromptSet: 'voice:writingPrompt:set',
  WritingPromptReset: 'voice:writingPrompt:reset',
  AgentRetry: 'agent:retry',
  AgentCancel: 'agent:cancel',
  MediaImport: 'media:import',
  MediaSavePasted: 'media:savePasted',
  MediaPick: 'media:pick',
  MediaDiscard: 'media:discard',
  MediaCancelImport: 'media:cancelImport',
  MediaSaveAs: 'media:saveAs',
  LocaleWeekStart: 'locale:weekStart',
  OnboardingStatus: 'onboarding:status',
  OnboardingSaveClientId: 'onboarding:saveClientId',
  OnboardingSaveOAuth1Keys: 'onboarding:saveOAuth1Keys',
  OnboardingComplete: 'onboarding:complete',
  AppGetOpenAtLogin: 'app:getOpenAtLogin',
  AppSetOpenAtLogin: 'app:setOpenAtLogin',
  AgentStatus: 'agent:status',
  AgentSetKey: 'agent:setKey',
  AgentClearKey: 'agent:clearKey',
  AgentSetModel: 'agent:setModel',
  AgentSetProvider: 'agent:setProvider',
  AgentRecheck: 'agent:recheck',
  AgentSetSendImages: 'agent:setSendImages',
  McpStatus: 'mcp:status',
  McpSetEnabled: 'mcp:setEnabled',
  McpRegenerateToken: 'mcp:regenerateToken',
  AuthConnect: 'auth:connect',
  AuthStatus: 'auth:status',
  AuthSetActive: 'auth:setActive',
  AuthDisconnect: 'auth:disconnect'
} as const

// Events main sends to every window.
export const IpcEvent = {
  PostsChanged: 'posts:changed',
  Agent: 'agent:event',
  /** A video being converted on import: { path, fraction } with fraction from 0 to 1. */
  MediaProgress: 'media:progress',
  /** An X account was connected, disconnected, switched to or needs signing in again. */
  AuthChanged: 'auth:changed',
  /** An account's chats changed: made, renamed, deleted, switched or given a title (OP-94). */
  ChatSessionsChanged: 'chat:sessions:changed',
  /** An account's voice was saved: { accountId, profile }. */
  VoiceChanged: 'voice:changed'
} as const

export interface PingResult {
  message: string
  electron: string
  platform: string
}

// Posts. See the memory page "post-scheduling-and-publishing-contract".

/**
 * pending_approval: written by the agent or an MCP client, and never sent until the user approves
 * it (OP-30); the user may instead reject it, and a rejected post stays visible, read-only, until
 * deleted (OP-34). An approved post is scheduled → posting → posted | failed.
 */
/** How late a post may be and still go out; later than this it is missed, and can't be approved as is. */
export const MISSED_AFTER_MS = 60 * 60 * 1000

export type PostStatus =
  'pending_approval' | 'rejected' | 'scheduled' | 'posting' | 'posted' | 'failed'

/** Who wrote or last changed a post: the user by hand, the in-app agent, or an outside MCP client. */
export type PostAuthor = 'user' | 'agent' | 'mcp'
/**
 * Why a post failed, which decides the buttons on its card:
 * missed (app was off for over an hour), auth (reconnect X), rejected (X refused the text: edit it),
 * retries_exhausted (X down or rate limited after all retries), uncertain (app closed mid-publish:
 * check X before posting again; never resent automatically).
 */
export type PostErrorCode = 'missed' | 'auth' | 'rejected' | 'retries_exhausted' | 'uncertain'

export type MediaKind = 'image' | 'gif' | 'video'

/** A file attached to a post part, copied into the app's own media folder. */
export interface PostMedia {
  id: string
  kind: MediaKind
  mime: string
  bytes: number
  /** Pixels, for images when known. */
  width: number | null
  height: number | null
  /** Video length, when known. */
  durationMs: number | null
  /** Alt text sent to X with the image. */
  alt: string | null
  /** opencat-media:// URL the renderer can put in <img> or <video>. */
  url: string
}

/** One post of a thread. A single post is a thread of one part. */
export interface PostPart {
  id: string
  /** 0 for the first post, then 1, 2, … for the replies. */
  position: number
  text: string
  /** Up to 4 images, or 1 GIF, or 1 video. */
  media: PostMedia[]
  /** Set by the publisher as each part goes out, so a failed thread resumes where it stopped. */
  remoteId: string | null
  remoteUrl: string | null
  postedAt: string | null
}

export interface Post {
  id: string
  /** X user id of the account it posts as; null until an account is connected. */
  accountId: string | null
  /** Who created it. Anything not from the user starts as pending_approval. */
  createdBy: PostAuthor
  /** The first part's text, for cards and lists. */
  text: string
  /** Always at least one part, in order. */
  parts: PostPart[]
  /** UTC ISO timestamp, e.g. 2026-09-28T07:30:00.000Z. The time the user picked. */
  scheduledAt: string
  /** When the publisher tries it again after X couldn't take it; null when no retry waits. */
  nextAttemptAt: string | null
  status: PostStatus
  postedAt: string | null
  /** The first part on X: the post itself, or the head of the thread. */
  remoteId: string | null
  remoteUrl: string | null
  error: string | null
  errorCode: PostErrorCode | null
  createdAt: string
  updatedAt: string
}

/** A local calendar date, YYYY-MM-DD, in the user's timezone. */
export type LocalDate = string

/** Media for a part: the id media.import or media.pick returned, and optional alt text. */
export interface NewPartMedia {
  id: string
  alt?: string | null
}

export interface NewPostPart {
  text: string
  media?: NewPartMedia[]
}

/** Give either `text` (a single post without media) or `parts`. */
export interface NewPost {
  accountId?: string | null
  text?: string
  parts?: NewPostPart[]
  /** Any string Date can parse; stored as UTC. */
  scheduledAt: string
}

/**
 * `parts` replaces every part. `text` alone changes only the first part's text and keeps its media
 * and the other parts. Parts already on X can't change.
 */
export interface PostPatch {
  text?: string
  parts?: NewPostPart[]
  scheduledAt?: string
  /** Moves the post to another signed-in X account (OP-63). */
  accountId?: string
}

export type DayCounts = Record<PostStatus, number>

export interface PendingSummary {
  count: number
  /** The day of the earliest post waiting for approval; null when none wait. */
  first: LocalDate | null
}

export interface PostsChangedEvent {
  ids: string[]
}

/**
 * Which X account's posts a list or count covers (OP-63): an account id, or null for every
 * account. Left out, it is the active account. Posts made before any account was connected
 * belong to every account.
 */
export type AccountScope = string | null

export interface PostsApi {
  create(post: NewPost): Promise<Post>
  get(id: string): Promise<Post | null>
  /** The post a media file is attached to, or null while it is unattached. */
  withMedia(mediaId: string): Promise<Post | null>
  listByDay(date: LocalDate, accountId?: AccountScope): Promise<Post[]>
  /** Posts from `from` to `to`, both inclusive, grouped by local day. At most 62 days. */
  listRange(
    from: LocalDate,
    to: LocalDate,
    accountId?: AccountScope
  ): Promise<Record<LocalDate, Post[]>>
  /** Every post waiting for approval, on any day, earliest first. */
  listPending(accountId?: AccountScope): Promise<Post[]>
  /** Every post with this status (e.g. 'rejected'), on any day, earliest first. */
  listByStatus(status: PostStatus, accountId?: AccountScope): Promise<Post[]>
  /** Counts per local date from `from` to `to`, both inclusive. Days without posts are left out. */
  countsByDay(
    from: LocalDate,
    to: LocalDate,
    accountId?: AccountScope
  ): Promise<Record<LocalDate, DayCounts>>
  update(id: string, patch: PostPatch): Promise<Post>
  reschedule(id: string, scheduledAt: string): Promise<Post>
  delete(id: string): Promise<void>
  /**
   * Lets a pending_approval post go out: it becomes scheduled, at `scheduledAt` when given.
   * Refused when its time is more than an hour past; give a new time then.
   */
  approve(id: string, scheduledAt?: string): Promise<Post>
  /** Turns down a pending_approval post: it stays, read-only, as rejected until deleted. */
  reject(id: string): Promise<Post>
  /** How many posts wait for approval, and the local day of the earliest one. */
  pending(accountId?: AccountScope): Promise<PendingSummary>
  /** Waiting posts per account id, for the account switcher; accounts with none are left out. */
  pendingByAccount(): Promise<Record<string, number>>
  /** Returns a function that stops listening. */
  onChanged(listener: (event: PostsChangedEvent) => void): () => void
}

// Settings: plain JSON values. Secrets go to the OS keychain, never here.

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface SettingsApi {
  get(key: string): Promise<JsonValue | null>
  set(key: string, value: JsonValue): Promise<void>
}

// Chat history with the agent: one conversation for now.

export type ChatRole = 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: string
  /** On assistant replies: who answered, like "Claude Code · Opus 5". Null on older messages. */
  via: string | null
  /** On user messages: the files they attached, still in the media store. */
  media: PostMedia[]
  /** The X account whose conversation it is; null before any account was connected. */
  accountId: string | null
  /** On user messages: what the composer asked for (OP-79); text on older ones. */
  mode: ComposerMode
  /** Sent before the user's text, like Video mode's showreel pre-prompt (OP-81). */
  preface: string | null
  /** The chat it belongs to (OP-94). */
  sessionId: string | null
}

/** One of an account's chats with the agent (OP-94). */
export interface ChatSession {
  id: string
  /** Null for the chat from before any account was connected. */
  accountId: string | null
  /** "New chat" until the first message names it, or the user renames it. */
  title: string
  createdAt: string
  /** When a message was last saved in it; lists are newest first. */
  updatedAt: string
  archived: boolean
  /** The account's open chat, which chat.list() and the composer use. */
  active: boolean
  /** The agent is answering in it right now. */
  streaming: boolean
}

export interface ChatSessionsChanged {
  accountId: string | null
}

export interface ChatSessionsApi {
  /** An account's chats, newest first; the active account's when left out. */
  list(accountId?: string | null): Promise<ChatSession[]>
  /** A new, empty chat that becomes the active one; on the active account when left out. */
  create(accountId?: string | null): Promise<ChatSession>
  /** Rejects an empty name, or one over 80 characters, with a plain message. */
  rename(id: string, title: string): Promise<ChatSession>
  /** Deletes the chat and its messages; the last one on an account is replaced by a new chat. */
  delete(id: string): Promise<void>
  setActive(id: string): Promise<ChatSession>
  onChanged(listener: (event: ChatSessionsChanged) => void): () => void
}

/** The composer's mode buttons: write a post, or a post with an image or a video made for it. */
export type ComposerMode = 'text' | 'image' | 'video'
export const COMPOSER_MODES: ComposerMode[] = ['text', 'image', 'video']

export interface NewChatMessage {
  role: ChatRole
  content: string
  via?: string | null
  /** Media ids from media.import or media.pick. */
  media?: string[]
  accountId?: string | null
  mode?: ComposerMode
  preface?: string | null
  sessionId?: string | null
}

/** Video mode's pre-prompt (OP-81), edited in Settings, Voice, Advanced (OP-75). */
export interface VideoPrePrompt {
  /** "{duration}" stands for the video's length in seconds. */
  text: string
  isDefault: boolean
}

export interface VideoApi {
  getPrePrompt(): Promise<VideoPrePrompt>
  /** Rejects an empty text; the change applies from the next message. */
  setPrePrompt(text: string): Promise<VideoPrePrompt>
  resetPrePrompt(): Promise<VideoPrePrompt>
}

/** What the agent can make on this machine, for the composer's mode buttons. */
export interface AgentCapabilities {
  /** Null when videos can be made; otherwise why not, for the Video button's tooltip. */
  videoUnavailable: string | null
}

/** Read-only apart from clear: the agent session is the only writer of the history. */
export interface ChatApi {
  /** The active chat of the active account. */
  list(): Promise<ChatMessage[]>
  /** Empties the active chat. Rejects while the agent is answering. */
  clear(): Promise<void>
  sessions: ChatSessionsApi
}

// The agent. Main owns the conversation: it saves every message to the chat
// history and tells the renderer through agent events. The renderer never
// calls chat.append itself.

/**
 * The body of a chat message with role "tool", as JSON: which posts a tool
 * call touched. Cards read the posts live by id, so they show current status.
 */
export interface PostsToolResult {
  kind: 'posts'
  action: 'created' | 'updated' | 'rescheduled' | 'deleted'
  postIds: string[]
}

/** An image the agent rendered from HTML (OP-33), kept in the media store until used or cleared. */
export interface RenderToolResult {
  kind: 'render'
  mediaId: string
  width: number
  height: number
  bytes: number
  /** opencat-media:// URL of the file, for the chat card. */
  url: string
  /** Set for a video the agent recorded (OP-35); an image has none. */
  durationMs?: number
}

/** The body of a "tool" chat message: something a tool call made that the chat draws. */
export type ToolResult = PostsToolResult | RenderToolResult

/**
 * no_key: no API key saved. bad_key: the provider refused the key.
 * no_cli: the claude CLI isn't installed. cli_login: it is, but isn't logged in.
 */
export type AgentErrorCode =
  'no_key' | 'bad_key' | 'no_cli' | 'cli_login' | 'network' | 'api' | 'other'

export type AgentEvent =
  /** A message was saved to the history: the user's, a tool result, or the assistant's text. */
  (
    | { type: 'message'; turnId: string; message: ChatMessage }
    /** More of the assistant's reply, not saved yet. */
    | { type: 'text'; turnId: string; delta: string }
    /** The agent started a tool call. */
    | { type: 'tool'; turnId: string; name: string }
    /** The turn ended. `stopped` when the user cancelled it. */
    | { type: 'done'; turnId: string; stopped: boolean }
    /** The turn failed. Any text streamed before it was saved first. */
    | { type: 'error'; turnId: string; code: AgentErrorCode; message: string }
  ) & {
    /** The account whose conversation the turn is in; the chat shows only the active one's. */
    accountId: string | null
    /** The chat the turn is in (OP-94); the panel shows only the active chat's. */
    sessionId: string | null
  }

export interface AgentTurnStarted {
  turnId: string
  accountId: string | null
  /** The chat the turn answers in, kept even if the user switches chats mid-turn (OP-94). */
  sessionId: string | null
}

export interface AgentModel {
  id: string
  label: string
}

/** What the settings form shows. The key itself never leaves main. */
export interface AgentStatus {
  hasKey: boolean
  /** False when the OS has no keyring to encrypt the key with (Linux without one). */
  canStoreKey: boolean
  model: string
  models: AgentModel[]
  /** Which one answers the next message: the claude CLI or the API key. */
  provider: AgentProvider
  /** False until the user picks; the provider is then the CLI when it is found. */
  providerChosen: boolean
  /** What OpenCatt found out about the claude CLI, from its last check. */
  cli: ClaudeCliStatus
  /** The chosen provider can answer: the CLI found and logged in, or a key saved. */
  ready: boolean
  /** Attached images go to the model as pictures, scaled to 1568px. On by default. */
  sendImages: boolean
}

/** cli: the user's own claude CLI on their Claude plan. api: an Anthropic API key. */
export type AgentProvider = 'cli' | 'api'

export interface ClaudeCliStatus {
  found: boolean
  /** Where it was found, for display. */
  path: string | null
  /** Like "2.1.283". */
  version: string | null
  loggedIn: boolean
  /** The Claude plan, like "max" or "pro", when the CLI says. */
  plan: string | null
  /** Why the check failed, when it ran but could not tell. */
  error: string | null
}

export interface AgentApi {
  /** Saves the user's message and starts a turn. Rejects while another turn runs. */
  /** `mediaIds` are files from media.import or media.pick, attached to this message. */
  /** `mode` is the composer's mode button (OP-79); text when left out. */
  /** `videoSeconds` is Video mode's length picker (OP-81); a length in the text wins. */
  send(
    text: string,
    mediaIds?: string[],
    mode?: ComposerMode,
    videoSeconds?: number
  ): Promise<AgentTurnStarted>
  capabilities(): Promise<AgentCapabilities>
  /** Runs a new turn on the history as it is, after an error. */
  retry(): Promise<AgentTurnStarted>
  /** Stops the running turn, if any. */
  cancel(): Promise<void>
  /** Returns a function that stops listening. */
  onEvent(listener: (event: AgentEvent) => void): () => void
  status(): Promise<AgentStatus>
  /** Checks the key with the provider, then saves it encrypted. Rejects with the reason. */
  setKey(key: string): Promise<AgentStatus>
  clearKey(): Promise<AgentStatus>
  setModel(model: string): Promise<AgentStatus>
  setSendImages(on: boolean): Promise<AgentStatus>
  setProvider(provider: AgentProvider): Promise<AgentStatus>
  /** Looks for the claude CLI again and asks it for its version and login. */
  recheck(): Promise<AgentStatus>
}

// Locale facts only main can read, such as the OS region.

/** A day of the week as date-fns numbers it: 0 is Sunday, 1 Monday, 6 Saturday. */
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** The settings key for the user's choice; absent means follow the system. */
export const WEEK_START_SETTING = 'calendar.weekStartsOn'

export type WeekStartSetting = 'auto' | 'monday' | 'sunday'

export interface LocaleApi {
  /** The first day of the week in the OS region, Monday when the region doesn't say. */
  weekStart(): Promise<WeekDay>
}

// Media: files are copied into the app's folder first, then attached to a post part by id.
// An import that is never attached is removed after a day.

export interface MediaApi {
  /** Copies files, by path, into the app. Rejects files X would refuse by type or size. */
  import(paths: string[]): Promise<PostMedia[]>
  /** Opens a file dialog and imports what the user picks; [] when they cancel. */
  pick(): Promise<PostMedia[]>
  /** Removes an import that isn't attached to a post, e.g. when the user takes it out again. */
  discard(id: string): Promise<void>
  /** Asks where to save a copy of the file; false when the user cancels. */
  saveAs(id: string): Promise<boolean>
  /** The path of a dropped or pasted File, for import(); '' when it has no file behind it. */
  pathForFile(file: File): string
  /**
   * Saves a pasted image or video with no file behind it (a screenshot, an image copied in a
   * browser) to a temporary file, and returns its path for import(), which then removes it.
   */
  savePasted(data: Uint8Array, type: string): Promise<string>
  /** Stops the video conversion an import or pick is waiting on; that call rejects. */
  cancelImport(): Promise<void>
  /** Conversion progress of a video being imported, 0 to 1. Returns a function that stops listening. */
  onProgress(listener: (event: MediaProgressEvent) => void): () => void
}

export interface MediaProgressEvent {
  path: string
  fraction: number
}

// First-run onboarding: the user's own X app. See src/shared/x.ts.

export interface OnboardingStatus {
  /** True once the user connected an X app and finished the wizard. */
  complete: boolean
  authMode: XAuthMode | null
  clientId: string | null
  /** False on Linux without a keyring: OAuth 1.0a keys can't be saved safely there. */
  secureStorage: boolean
}

export interface OnboardingApi {
  status(): Promise<OnboardingStatus>
  saveClientId(clientId: string): Promise<OnboardingStatus>
  saveOAuth1Keys(keys: OAuth1Keys): Promise<OnboardingStatus>
  complete(): Promise<OnboardingStatus>
}

export interface AppApi {
  getOpenAtLogin(): Promise<boolean>
  setOpenAtLogin(openAtLogin: boolean): Promise<void>
}

// X accounts, all signed in through the user's one X app (OP-5). Posts carry the account's id.

export interface XAccount {
  /** The X user id. */
  id: string
  /** Without the "@"; refreshed whenever the token is. */
  handle: string
  name: string | null
  avatarUrl: string | null
  mode: XAuthMode
  /** X refused its token: the user has to sign in again (auth.connect) before it can post. */
  needsReconnect: boolean
}

export interface AuthStatus {
  accounts: XAccount[]
  /** The account new posts go out from, and whose calendar the app shows. */
  activeAccountId: string | null
  /** False on Linux without a keyring: connect refuses, since tokens are never stored unencrypted. */
  secureStorage: boolean
}

export interface AuthApi {
  /**
   * Opens X in the browser and waits for the user to allow access. Signing in as an account that
   * is already connected refreshes it. Rejects with an AuthError whose code is callback_mismatch,
   * cancelled, timeout or network (see src/shared/authErrors.ts); calling it again cancels the
   * pending one.
   */
  connect(): Promise<{ accountId: string; handle: string }>
  status(): Promise<AuthStatus>
  setActive(accountId: string): Promise<AuthStatus>
  /**
   * Signs the account out on X and forgets its tokens. The account and its posts stay, with
   * needsReconnect set, until the user signs in to it again.
   */
  disconnect(accountId: string): Promise<AuthStatus>
  onChanged(listener: (status: AuthStatus) => void): () => void
}

// The local MCP server that lets outside agents (Claude Code, Claude Desktop) schedule posts.

export interface McpStatus {
  enabled: boolean
  running: boolean
  /** Why it isn't running although enabled, e.g. the port is taken. */
  error: string | null
  /** Ready to paste, present while enabled. They contain the access token. */
  claudeCode?: string
  claudeDesktop?: string
}

export interface McpApi {
  status(): Promise<McpStatus>
  setEnabled(enabled: boolean): Promise<McpStatus>
  regenerateToken(): Promise<McpStatus>
}

/** Whether the agent makes an image for a post with render_image (OP-74). */
export type VoiceImages = 'always' | 'ask' | 'never'

/**
 * How an X account's posts should sound (OP-74), edited in Settings, Voice (OP-75). The agent
 * reads it for every turn on that account and never changes it.
 */
export interface VoiceProfile {
  description: string
  /** Up to 10 posts in this voice, each within 280 characters as X counts them. */
  examples: string[]
  /** 'auto' writes in the language the user writes in; otherwise a language code like 'pt-BR'. */
  language: string
  emoji: boolean
  hashtags: boolean
  images: VoiceImages
}

export interface VoiceChanged {
  accountId: string
  profile: VoiceProfile
}

/** The agent's base writing guide (OP-74): the built-in one, or the user's own text. */
export interface WritingPrompt {
  text: string
  isDefault: boolean
}

export interface VoiceApi {
  /** The saved voice, or the defaults when none is: '', [], 'auto', false, false, 'ask'. */
  get(accountId: string): Promise<VoiceProfile>
  /** Saves the given fields; rejects with a plain message. Applies from the next message. */
  set(accountId: string, patch: Partial<VoiceProfile>): Promise<VoiceProfile>
  onChanged(listener: (event: VoiceChanged) => void): () => void
  getWritingPrompt(): Promise<WritingPrompt>
  /** Rejects an empty text. The account's voice still applies on top of it. */
  setWritingPrompt(text: string): Promise<WritingPrompt>
  resetWritingPrompt(): Promise<WritingPrompt>
}

export interface OpenCatApi {
  ping(): Promise<PingResult>
  locale: LocaleApi
  posts: PostsApi
  settings: SettingsApi
  chat: ChatApi
  agent: AgentApi
  video: VideoApi
  voice: VoiceApi
  mcp: McpApi
  media: MediaApi
  onboarding: OnboardingApi
  auth: AuthApi
  app: AppApi
}
