import { copyFileSync } from 'node:fs'
import { extname } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import {
  COMPOSER_MODES,
  IpcChannel,
  IpcEvent,
  type AccountScope,
  type AgentCapabilities
} from '@shared/api'
import { tagAuthError } from '@shared/authErrors'
import type { AgentSession, AgentSettings } from '../agent'
import type { VideoPrePromptStore } from '../agent/videoPrompt'
import type { VoiceStore, WritingPromptStore } from '../agent/voice'
import type { XAuthService } from '../auth/service'
import type { McpManager } from '../mcp/manager'
import type { Stores } from '../db'
import { weekStartFor } from '../locale'
import { getOpenAtLogin, setOpenAtLogin } from '../loginItem'
import { SUPPORTED_EXTENSIONS } from '../media/files'
import type { MediaImports } from '../media/imports'
import type { PastedFiles } from '../media/pasted'
import type { OnboardingService } from '../onboarding'
import { ping } from '../ping'
import { showPendingBadge } from '../badge'

/** Wires every renderer call to the stores. Handlers stay thin: the rules live in the stores. */
export function registerIpc(
  { posts, settings, media }: Stores,
  agent: AgentSession,
  onboarding: OnboardingService,
  agentSettings: AgentSettings,
  mcp: McpManager,
  auth: XAuthService,
  imports: MediaImports,
  /** What the agent can make here, for the composer's mode buttons (OP-79). */
  capabilities: () => AgentCapabilities = () => ({ videoUnavailable: null }),
  extras: {
    prePrompt?: VideoPrePromptStore
    voices?: VoiceStore
    writing?: WritingPromptStore
    pasted?: PastedFiles
  } = {}
): void {
  const { prePrompt, voices, writing, pasted } = extras
  ipcMain.handle(IpcChannel.Ping, () => ping(process.versions.electron, process.platform))
  // The OS region, not the UI language: an English system set to Germany starts on Monday.
  ipcMain.handle(IpcChannel.LocaleWeekStart, () => weekStartFor(app.getSystemLocale()))

  ipcMain.handle(IpcChannel.PostsCreate, (_e, post) => posts.create(post))
  ipcMain.handle(IpcChannel.PostsGet, (_e, id) => posts.get(id))
  ipcMain.handle(IpcChannel.PostsWithMedia, (_e, id) => posts.withMedia(String(id)))
  ipcMain.handle(IpcChannel.PostsListByDay, (_e, date, account) =>
    posts.listByDay(date, scopeOf(account))
  )
  ipcMain.handle(IpcChannel.PostsListRange, (_e, from, to, account) =>
    posts.listRange(from, to, scopeOf(account))
  )
  ipcMain.handle(IpcChannel.PostsListPending, (_e, account) => posts.listPending(scopeOf(account)))
  ipcMain.handle(IpcChannel.PostsListByStatus, (_e, status, account) =>
    posts.listByStatus(status, scopeOf(account))
  )
  ipcMain.handle(IpcChannel.PostsCountsByDay, (_e, from, to, account) =>
    posts.countsByDay(from, to, scopeOf(account))
  )
  ipcMain.handle(IpcChannel.PostsUpdate, (_e, id, patch) => posts.update(id, patch))
  ipcMain.handle(IpcChannel.PostsReschedule, (_e, id, at) => posts.reschedule(id, at))
  ipcMain.handle(IpcChannel.PostsDelete, (_e, id) => posts.delete(id))
  ipcMain.handle(IpcChannel.PostsApprove, (_e, id, scheduledAt) =>
    posts.approve(String(id), scheduledAt === undefined ? undefined : String(scheduledAt))
  )
  ipcMain.handle(IpcChannel.PostsReject, (_e, id) => posts.reject(String(id)))
  ipcMain.handle(IpcChannel.PostsPending, (_e, account) => posts.pending(scopeOf(account)))
  ipcMain.handle(IpcChannel.PostsPendingByAccount, () => posts.pendingByAccount())

  ipcMain.handle(IpcChannel.SettingsGet, (_e, key) => settings.get(key))
  ipcMain.handle(IpcChannel.SettingsSet, (_e, key, value) => {
    // These have their own calls, which check what they save.
    if (/^(x|onboarding)\./.test(String(key))) {
      throw new Error(`${String(key)} can't be set directly`)
    }
    settings.set(key, value)
  })

  ipcMain.handle(IpcChannel.ChatList, () => agent.history())
  // Clearing goes through the session, so it can't empty the history under a running turn.
  ipcMain.handle(IpcChannel.ChatClear, () => agent.clear())
  // An account's chats (OP-94).
  const accountArg = (value: unknown): string | null | undefined =>
    value === undefined ? undefined : value === null ? null : String(value)
  ipcMain.handle(IpcChannel.ChatSessionsList, (_e, accountId) =>
    agent.chatList(accountArg(accountId))
  )
  ipcMain.handle(IpcChannel.ChatSessionsCreate, (_e, accountId) =>
    agent.newChat(accountArg(accountId))
  )
  ipcMain.handle(IpcChannel.ChatSessionsRename, (_e, id, title) =>
    agent.renameChat(String(id), String(title ?? ''))
  )
  ipcMain.handle(IpcChannel.ChatSessionsDelete, (_e, id) => agent.deleteChat(String(id)))
  ipcMain.handle(IpcChannel.ChatSessionsSetActive, (_e, id) => agent.setActiveChat(String(id)))

  ipcMain.handle(IpcChannel.OnboardingStatus, () => onboarding.status())
  ipcMain.handle(IpcChannel.OnboardingSaveClientId, (_e, id) => onboarding.saveClientId(id))
  ipcMain.handle(IpcChannel.OnboardingSaveOAuth1Keys, async (_e, keys) => {
    const status = onboarding.saveOAuth1Keys(keys)
    // The keys belong to one account; it shows up in auth.status() once X says whose.
    await auth.adoptOAuth1()
    return status
  })

  ipcMain.handle(IpcChannel.AuthConnect, async () => {
    try {
      return await auth.connect()
    } catch (err) {
      throw tagAuthError(err)
    }
  })
  ipcMain.handle(IpcChannel.AuthStatus, () => auth.status())
  ipcMain.handle(IpcChannel.AuthSetActive, (_e, id) => auth.setActive(String(id)))
  ipcMain.handle(IpcChannel.AuthDisconnect, (_e, id) => auth.disconnect(String(id)))
  ipcMain.handle(IpcChannel.OnboardingComplete, () => onboarding.complete())

  ipcMain.handle(IpcChannel.AppGetOpenAtLogin, () => getOpenAtLogin())
  ipcMain.handle(IpcChannel.AppSetOpenAtLogin, (_e, on) => setOpenAtLogin(Boolean(on)))

  ipcMain.handle(IpcChannel.AgentSend, (_e, text, mediaIds, mode, videoSeconds) =>
    agent.send(
      text,
      Array.isArray(mediaIds) ? mediaIds.map(String) : [],
      COMPOSER_MODES.includes(mode) ? mode : 'text',
      typeof videoSeconds === 'number' ? videoSeconds : undefined
    )
  )
  if (prePrompt) {
    ipcMain.handle(IpcChannel.VideoPrePromptGet, () => prePrompt.get())
    ipcMain.handle(IpcChannel.VideoPrePromptSet, (_e, text) => prePrompt.set(String(text)))
    ipcMain.handle(IpcChannel.VideoPrePromptReset, () => prePrompt.reset())
  }
  if (voices) {
    ipcMain.handle(IpcChannel.VoiceGet, (_e, accountId) => voices.get(String(accountId)))
    ipcMain.handle(IpcChannel.VoiceSet, (_e, accountId, patch) =>
      voices.set(String(accountId), patch)
    )
  }
  if (writing) {
    ipcMain.handle(IpcChannel.WritingPromptGet, () => writing.get())
    ipcMain.handle(IpcChannel.WritingPromptSet, (_e, text) => writing.set(String(text)))
    ipcMain.handle(IpcChannel.WritingPromptReset, () => writing.reset())
  }
  ipcMain.handle(IpcChannel.AgentCapabilities, () => capabilities())
  ipcMain.handle(IpcChannel.AgentRetry, () => agent.retry())
  ipcMain.handle(IpcChannel.AgentCancel, () => agent.cancel())
  ipcMain.handle(IpcChannel.AgentStatus, () => agentSettings.status())
  ipcMain.handle(IpcChannel.AgentSetKey, (_e, key) => agentSettings.setKey(key))
  ipcMain.handle(IpcChannel.AgentClearKey, () => agentSettings.clearKey())
  ipcMain.handle(IpcChannel.AgentSetModel, (_e, model) => agentSettings.setModel(model))
  ipcMain.handle(IpcChannel.AgentSetSendImages, (_e, on) =>
    agentSettings.setSendImages(on === true)
  )
  ipcMain.handle(IpcChannel.AgentSetProvider, (_e, provider) => agentSettings.setProvider(provider))
  ipcMain.handle(IpcChannel.AgentRecheck, () => agentSettings.recheck())
  ipcMain.handle(IpcChannel.McpStatus, () => mcp.status())
  ipcMain.handle(IpcChannel.McpSetEnabled, (_e, enabled) => mcp.setEnabled(enabled === true))
  ipcMain.handle(IpcChannel.McpRegenerateToken, () => mcp.regenerateToken())

  ipcMain.handle(IpcChannel.MediaImport, (_e, paths: unknown) => {
    if (!Array.isArray(paths)) throw new Error('Expected a list of file paths')
    const list = paths.map(String)
    // A pasted file's temporary copy goes once it's imported, or refused (OP-89).
    return imports.import(list).finally(() => pasted?.release(list))
  })
  if (pasted) {
    ipcMain.handle(IpcChannel.MediaSavePasted, (_e, data: unknown, type: unknown) => {
      if (!(data instanceof Uint8Array)) throw new Error('Expected the pasted file')
      return pasted.save(data, String(type))
    })
  }
  ipcMain.handle(IpcChannel.MediaPick, async (e) => {
    const window = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Add images or a video',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images and videos', extensions: SUPPORTED_EXTENSIONS }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? [] : imports.import(result.filePaths)
  })
  ipcMain.handle(IpcChannel.MediaDiscard, (_e, id) => media.discard(String(id)))
  ipcMain.handle(IpcChannel.MediaCancelImport, () => imports.cancelImport())
  ipcMain.handle(IpcChannel.MediaSaveAs, async (e, id) => {
    const source = media.pathOf(String(id))
    const ext = extname(source)
    const window = BrowserWindow.fromWebContents(e.sender)
    const options: Electron.SaveDialogOptions = {
      title: 'Save image',
      defaultPath: `opencat-${new Date().toISOString().slice(0, 10)}${ext}`,
      filters: [{ name: 'Image', extensions: [ext.slice(1)] }]
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    copyFileSync(source, result.filePath)
    return true
  })

  posts.onChanged((event) => {
    broadcast(IpcEvent.PostsChanged, event)
    // The Dock and taskbar badge counts every account, so nothing waiting is out of sight.
    showPendingBadge(posts.pending(null).count, BrowserWindow.getAllWindows())
  })
}

/** An AccountScope from the renderer: an id, null for every account, or left out for the active one. */
function scopeOf(account: unknown): AccountScope | undefined {
  if (account === undefined || account === null) return account
  return String(account)
}

export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}
