import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  Notification,
  nativeImage,
  nativeTheme,
  net,
  powerMonitor,
  shell,
  type Tray
} from 'electron'
import { autoUpdater } from 'electron-updater'
import { IpcEvent } from '@shared/api'
import { CredentialStore } from './auth/credentials'
import { safeStorageCipher } from './auth/safeStorageCipher'
import { XAuthService } from './auth/service'
import {
  AgentConfig,
  AgentSession,
  AgentSettings,
  AnthropicRunner,
  namedAccounts,
  postTools,
  TurnScope,
  type TurnAccount
} from './agent'
import { electronImageLoader } from './agent/imageLoader'
import { offscreenRenderer } from './agent/render/offscreen'
import { gsapLoader } from './agent/render/gsap'
import { offscreenRecorder } from './agent/render/recorder'
import { videoPreface } from './agent/videoPreface'
import { VideoPrePromptStore } from './agent/videoPrompt'
import { VoiceStore, WritingPromptStore } from './agent/voice'
import { AutopilotStore } from './agent/autopilot'
import { StatsService, withPostingCosts } from './stats/service'
import type { AssetSource } from './agent/render/assets'
import { renderImageTool } from './agent/render/tool'
import { renderVideoTool } from './agent/render/videoTool'
import {
  AgentMcpEndpoint,
  ClaudeCliRunner,
  ProviderRunner,
  detectClaude,
  findClaude
} from './agent/cli'
import { openStores, type Stores } from './db'
import { broadcast, registerIpc } from './ipc'
import { McpManager } from './mcp/manager'
import { McpHttpServer, mcpTools } from './mcp/server'
import { requireFfmpeg, type FfmpegBinaries } from './media/ffmpeg'
import { MediaImports } from './media/imports'
import { PastedFiles } from './media/pasted'
import { handleMediaProtocol, registerMediaScheme } from './media/protocol'
import { VideoPreparer } from './media/video'
import { OnboardingService } from './onboarding'
import { showPendingBadge } from './badge'
import { moveLegacyUserData } from './legacyData'
import { openedAtLogin, upgradeLoginItem } from './loginItem'
import { trayIconPath, windowIconPath } from './appIcons'
import { Publisher } from './publisher'
import { createTray, onLastWindowClosed, tellAboutTrayOnce } from './tray'
import { startUpdates } from './updates'
import { XClient } from './x/client'

registerMediaScheme()

// Builds from before the rename kept their data in .../OpenCat; bring it over once (OP-100). This
// must come before the single-instance lock, which is the first thing to write to userData.
if (app.isPackaged) {
  try {
    const moved = moveLegacyUserData(app.getPath('appData'), app.getPath('userData'))
    if (moved) console.info(`Moved OpenCat data into ${app.getPath('userData')}:`, moved)
  } catch (err) {
    console.error('Could not move the old OpenCat data folder:', err)
  }
}

// One OpenCatt at a time: a second copy would run a second publisher and could send every due
// post twice. A second launch just brings the first one's window forward.
const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()
else app.on('second-instance', () => showWindow())

// The product is called OpenCatt (OP-52). The userData folder (the database, media and credential
// files) follows productName and is .../OpenCatt, which the move above fills from the old folder.
// The name safeStorage encrypts with (the macOS keychain entry "OpenCat Safe Storage", libsecret
// on Linux) follows this call instead, so it stays OpenCat and moved credentials still decrypt.
// Never change it. On Windows the key is in userData's Local State, which moves with the folder.
app.setName('OpenCat')
app.setAboutPanelOptions({
  applicationName: 'OpenCatt',
  credits:
    'Includes FFmpeg 8.1.3 under the LGPL 2.1 or later (https://ffmpeg.org). Licences and source ' +
    'links are in the app’s resources/third-party folder.'
})
// Taskbar grouping and the Start menu shortcut match on this id (electron-builder uses appId).
if (process.platform === 'win32') app.setAppUserModelId('io.github.opencat.app')

/** Electron throws on an icon path that doesn't exist; a missing icon should just mean none. */
const existingOrUndefined = (path: string | undefined): string | undefined =>
  path && existsSync(path) ? path : undefined

const iconPlaces = (): Parameters<typeof windowIconPath>[0] => ({
  packaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  appPath: app.getAppPath(),
  platform: process.platform
})

function createWindow(): void {
  nativeTheme.themeSource = 'dark'
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'OpenCatt',
    icon: existingOrUndefined(windowIconPath(iconPlaces())),
    // Dark only (boss, epic 8). The traffic lights sit in the sidebar on macOS.
    backgroundColor: '#09090b',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.once('ready-to-show', () => window.show())

  // Links open in the user's browser, never in a new app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

let stores: Stores | undefined
let agent: AgentSession | undefined
let mcp: McpManager | undefined
let agentEndpoint: AgentMcpEndpoint | undefined
let publisher: Publisher | undefined
let tray: Tray | undefined
let quitting = false

/** Brings the window back, from the tray, the Dock, Finder or a second launch. */
function showWindow(): void {
  // A start at login hid the Dock icon (OP-68); an open window gets it back.
  if (process.platform === 'darwin') void app.dock?.show()
  const [window] = BrowserWindow.getAllWindows()
  if (!window) return createWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

void app.whenReady().then(() => {
  if (!primary) return
  // pnpm dev runs inside Electron.app, whose Info.plist names it "Electron" in Cmd-Tab and the
  // menu bar; only the packaged OpenCatt.app carries our name. The Dock icon can at least be ours.
  if (process.platform === 'darwin' && !app.isPackaged) {
    const devIcon = join(app.getAppPath(), 'build', 'icon.png')
    // Cosmetic only: a missing or unreadable file must never stop the app starting.
    if (existsSync(devIcon)) {
      try {
        app.dock?.setIcon(devIcon)
      } catch (err) {
        console.warn('Could not set the dev Dock icon:', err)
      }
    }
  }
  const userData = app.getPath('userData')
  stores = openStores(join(userData, 'opencat.db'), join(userData, 'media'), (path) => {
    const size = nativeImage.createFromPath(path).getSize()
    return size.width > 0 ? size : null
  })
  // Files the chat still shows stay until the chat is cleared.
  stores.media.sweep(stores.chat.mediaIds())
  handleMediaProtocol(stores.media)
  // The agent's key gets its own encrypted file, apart from the X credentials.
  const agentSecrets = new CredentialStore(
    join(userData, 'agent-credentials.bin'),
    safeStorageCipher
  )
  const config = new AgentConfig(agentSecrets, stores.settings)
  // Installs from before the default moved to Opus 5.5 keep Opus 5 (OP-93).
  config.keepPreviousDefault()
  // The in-app agent's tools; outside MCP clients get their own, marked as such.
  // It may attach only files the user gave it in this chat.
  const chat = stores.chat
  // Each X account has its own conversation, and a turn acts only in its account (OP-61). Auth
  // is made further down, so the active account is read through it once it exists.
  const authRef: { current?: XAuthService } = {}
  // Each account's voice and the writing guide, from Settings (OP-74); read as each turn starts.
  const voices = new VoiceStore(
    stores.settings,
    (id) => stores!.accounts.get(id) !== null,
    (accountId, profile) => broadcast(IpcEvent.VoiceChanged, { accountId, profile })
  )
  const writing = new WritingPromptStore(stores.settings)
  // Autopilot per account (OP-103): agent and MCP posts scheduled without approval when it's on.
  const autopilot = new AutopilotStore(
    stores.settings,
    (id) => stores!.accounts.get(id) !== null,
    (accountId, on) => broadcast(IpcEvent.AutopilotChanged, { accountId, on })
  )
  stores.posts.useAutopilot((accountId, by) => autopilot.allows(accountId, by))
  // Pasted images with no file behind them wait here until imported (OP-89).
  const pasted = new PastedFiles(join(userData, 'pasted'))
  pasted.sweep()
  const activeAccount = (): TurnAccount | null => {
    const status = authRef.current?.status()
    const account = status?.accounts.find((a) => a.id === status.activeAccountId)
    return account
      ? {
          id: account.id,
          handle: account.handle,
          name: account.name,
          voice: voices.get(account.id),
          autopilot: autopilot.get(account.id)
        }
      : null
  }
  const turnScope = new TurnScope()
  const agentTools = postTools(
    stores.posts,
    undefined,
    'agent',
    // The files in the turn's own chat (OP-94); none outside a turn.
    () => (turnScope.session ? chat.mediaIds(turnScope.session) : new Set<string>()),
    {
      forCall: () => turnScope.current?.id ?? null,
      attached: () => turnScope.attached
    }
  )
  // Attached images go to the model as pictures unless the user turned that off (OP-21).
  const media = stores.media
  const images = electronImageLoader(
    (id) => media.pathOf(id),
    () => config.sendImages()
  )
  // Looked up on each video, so a missing binary gives a clear message rather than a crash.
  const ffmpegBinaries = (): FfmpegBinaries =>
    requireFfmpeg({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      platform: process.platform,
      arch: process.arch
    })
  // The user's attachments a render may place as they are, as asset://<media id> (OP-89).
  const renderAssets: AssetSource = {
    allowed: () => (turnScope.session ? chat.mediaIds(turnScope.session) : new Set<string>()),
    lookup: (id) => {
      const found = media.get(id)
      return found ? { kind: found.kind, path: media.pathOf(id) } : null
    },
    attached: () => turnScope.attached
  }
  // render_image (OP-33): the model always sees its own renders, whatever the setting says.
  const tools = [
    ...agentTools,
    renderImageTool(
      offscreenRenderer(),
      media,
      electronImageLoader(
        (id) => media.pathOf(id),
        () => true
      ),
      renderAssets
    ),
    // render_video (OP-35): the composition played frame by frame into the bundled ffmpeg.
    renderVideoTool(
      offscreenRecorder(
        ffmpegBinaries,
        () => media.tempPath('.mp4'),
        // GSAP for HyperFrames videos (OP-81): fetched once by main, never by the recording page.
        gsapLoader(join(userData, 'vendor'), async (url) => {
          const response = await net.fetch(url)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          return Buffer.from(await response.arrayBuffer())
        })
      ),
      media,
      () => turnScope.signal,
      (png) => (png.length ? { mediaType: 'image/png', data: png.toString('base64') } : null),
      renderAssets,
      { used: () => turnScope.videos, add: () => void turnScope.videos++ }
    )
  ]
  const runner = new AnthropicRunner(config, tools, undefined, undefined, images)
  // The agent on the user's own Claude plan, through their claude CLI (OP-28).
  agentEndpoint = new AgentMcpEndpoint(tools)
  const cliRunner = new ClaudeCliRunner({
    endpoint: agentEndpoint,
    allowedTools: AgentMcpEndpoint.toolNames(tools),
    find: () => findClaude(),
    workDir: join(userData, 'agent-cli'),
    settings: stores.settings,
    model: () => config.model(),
    images,
    chats: stores.chatSessions
  })
  const agentSettings = new AgentSettings(
    config,
    (key) => runner.checkKey(key),
    {
      found: () => findClaude() !== null,
      detect: () => detectClaude(() => findClaude())
    },
    (key) => runner.listModels(key)
  )
  const prePrompt = new VideoPrePromptStore(stores.settings)
  agent = new AgentSession(
    stores.chat,
    new ProviderRunner(cliRunner, runner, () => agentSettings.provider()),
    (event) => broadcast(IpcEvent.Agent, event),
    () => agentSettings.via(),
    (ids) => {
      const media = stores!.media
      for (const id of ids) {
        try {
          media.discard(id)
        } catch {
          // Attached to a post by now: it stays with the post.
        }
      }
    },
    activeAccount,
    turnScope,
    // Video mode's showreel pre-prompt (OP-81), with the length filled in, before the user's text.
    (mode, text, videoSeconds) =>
      mode === 'video' ? videoPreface(prePrompt.get().text, text, videoSeconds) : null,
    () => writing.get().text,
    stores.chatSessions,
    (accountId) => broadcast(IpcEvent.ChatSessionsChanged, { accountId })
  )

  // Off until the user turns it on; the same tools, minus editing and deleting.
  mcp = new McpManager(
    new McpHttpServer({
      tools: mcpTools(
        postTools(
          stores.posts,
          undefined,
          'mcp',
          undefined,
          namedAccounts(
            () => authRef.current?.status().accounts ?? [],
            () => authRef.current?.status().activeAccountId ?? null
          )
        )
      ),
      token: () => mcp!.token(),
      version: app.getVersion()
    }),
    stores.settings,
    {
      connectionFile: join(userData, 'mcp.json'),
      exe: process.execPath,
      bridge: join(__dirname, 'mcp-bridge.js')
    }
  )
  void mcp.restore()

  const credentials = new CredentialStore(join(userData, 'x-credentials.bin'), safeStorageCipher)
  const auth = new XAuthService({
    accounts: stores.accounts,
    posts: stores.posts,
    settings: stores.settings,
    credentials,
    openBrowser: (url) => shell.openExternal(url),
    // Autopilot doesn't outlive a disconnect (OP-105).
    onDisconnected: (accountId) => autopilot.turnOff(accountId),
    onChanged: (status) => {
      // The conversation from before any account goes to the first one, like its posts do.
      if (status.activeAccountId) {
        chat.assignAccount(status.activeAccountId)
        stores!.chatSessions.assignAccount(status.activeAccountId)
      }
      broadcast(IpcEvent.AuthChanged, status)
      for (const account of status.accounts) {
        if (!account.needsReconnect) publisher?.signedIn(account.id)
      }
    }
  })
  authRef.current = auth
  const x = new XClient({
    auth,
    mediaPath: (id) => stores!.media.pathOf(id),
    videos: stores.xMedia
  })
  // Post stats read back from X on demand, and what calls to X cost (OP-109).
  const stats = new StatsService({
    db: stores.db,
    settings: stores.settings,
    activeAccount: () => auth.status().activeAccountId,
    readTimeline: (accountId, max) => x.readTimeline(accountId, max),
    onChanged: (accountId) => broadcast(IpcEvent.StatsChanged, { accountId })
  })
  stats.estimateOlderPosts()
  // Installs that pasted OAuth 1.0a keys before accounts existed get theirs now.
  void auth.adoptOAuth1()
  registerIpc(
    stores,
    agent,
    new OnboardingService(stores.settings, credentials),
    agentSettings,
    mcp,
    auth,
    new MediaImports(
      stores.media,
      // Looked up on each video, so a missing binary gives a clear message rather than a crash.
      new VideoPreparer(ffmpegBinaries),
      (path, fraction) => broadcast(IpcEvent.MediaProgress, { path, fraction })
    ),
    () => {
      // Video is made with the bundled ffmpeg (OP-35); without it the Video mode is off.
      try {
        ffmpegBinaries()
        return { videoUnavailable: null }
      } catch {
        return {
          videoUnavailable:
            "Video needs OpenCatt's video tools, which are missing from this install."
        }
      }
    },
    { prePrompt, voices, writing, pasted, autopilot, stats }
  )
  // Posts go out at their time from here (OP-10), each as its own account (OP-5, OP-6).
  const accounts = stores.accounts
  publisher = new Publisher({
    posts: stores.posts,
    // Each X post's cost goes in the ledger once it's on X (OP-109), never breaking the publish.
    publish: withPostingCosts((post, onPart) => x.publish(post, onPart), stats),
    prepare: (post) => x.prepare(post),
    account: (id) => accounts.get(id),
    onSignedOut: (account) => {
      if (!Notification.isSupported()) return
      const who = account ? `@${account.handle}` : 'your X account'
      const notice = new Notification({
        title: `Couldn't post as ${who}`,
        body: `X signed ${who} out. Reconnect it in OpenCatt to keep posting.`
      })
      notice.on('click', showWindow)
      notice.show()
    }
  })
  stores.posts.onChanged(() => void publisher?.poke())
  powerMonitor.on('resume', () => void publisher?.poke())
  publisher.start().catch((err) => console.error('Publisher failed to start:', err))

  tray = createTray({
    iconPath: trayIconPath({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
      platform: process.platform
    }),
    onOpen: showWindow,
    onQuit: () => app.quit()
  })

  // A start at login opens only the tray (OP-68): the publisher runs, the window waits until the
  // user asks for it. Login items from before OP-68 are rewritten to start that way too.
  upgradeLoginItem()
  if (openedAtLogin()) {
    if (process.platform === 'darwin') app.dock?.hide()
  } else {
    createWindow()
  }
  showPendingBadge(stores.posts.pending(null).count, BrowserWindow.getAllWindows())

  // New versions (OP-14): Windows and the AppImage update themselves; macOS and the deb, which
  // can't unsigned, get a notice that opens the release.
  startUpdates({
    packaged: app.isPackaged,
    platform: process.platform,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    version: app.getVersion(),
    appImage: Boolean(process.env['APPIMAGE']),
    autoUpdate: () => autoUpdater.checkForUpdatesAndNotify(),
    notify: (version, url) => {
      if (!Notification.isSupported()) return
      const notice = new Notification({
        title: `OpenCatt ${version} is out`,
        body: 'Click to download it from GitHub.'
      })
      notice.on('click', () => void shell.openExternal(url))
      notice.show()
    }
  })

  app.on('activate', showWindow)
})

app.on('before-quit', () => {
  quitting = true
})

app.on('will-quit', () => {
  publisher?.stop()
  publisher = undefined
  tray?.destroy()
  tray = undefined
  void mcp?.stop()
  mcp = undefined
  void agentEndpoint?.stop()
  agentEndpoint = undefined
  agent?.close()
  agent = undefined
  stores?.db.close()
  stores = undefined
})

// Closing the window keeps OpenCatt running in the tray, so scheduled posts still go out; on macOS
// it also leaves the Dock and Cmd-Tab (OP-107).
app.on('window-all-closed', () =>
  onLastWindowClosed({
    quitting,
    platform: process.platform,
    tellOnce: () => {
      if (stores) tellAboutTrayOnce(stores.settings)
    },
    hideDock: () => app.dock?.hide()
  })
)
