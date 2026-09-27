import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Updates (OP-14). The builds aren't code signed, so:
// - Windows (NSIS) and the AppImage update themselves through electron-updater, which doesn't
//   need a signature there.
// - macOS can't: Squirrel.Mac only installs signed updates. The deb is installed by the system
//   package manager. Both get a notice with a link to the release instead.
// The one setting is package.json's "repository" (github:owner/repo). electron-builder reads it
// to write latest*.yml and app-update.yml; without it there are no updates at all.

/** How often a running app looks for a new version. */
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

export interface GitHubRepo {
  owner: string
  repo: string
}

/** owner/repo from package.json's "repository", in any of npm's forms; null when unset. */
export function repoOf(pkg: { repository?: unknown }): GitHubRepo | null {
  const field = pkg.repository
  const raw =
    typeof field === 'string'
      ? field
      : typeof field === 'object' && field !== null && 'url' in field
        ? String((field as { url: unknown }).url)
        : ''
  const match =
    /^(?:github:|(?:git\+)?https:\/\/github\.com\/|git@github\.com:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
      raw.trim()
    )
  return match ? { owner: match[1]!, repo: match[2]! } : null
}

/** Whether version `a` is newer than `b`. Numbers only; a leading "v" and any "-pre" are ignored. */
export function isNewer(a: string, b: string): boolean {
  const parts = (v: string): number[] =>
    v
      .replace(/^v/, '')
      .split('-')[0]!
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0)
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}

export type UpdateMode = 'auto' | 'notice' | 'off'

/** How this build can update: itself, a notice with a link, or not at all. */
export function updateMode(o: {
  packaged: boolean
  platform: NodeJS.Platform
  appImage: boolean
  repo: GitHubRepo | null
  /** app-update.yml, which electron-builder writes next to app.asar when publishing is set. */
  hasUpdateConfig: boolean
}): UpdateMode {
  if (!o.packaged || !o.repo) return 'off'
  if ((o.platform === 'win32' || (o.platform === 'linux' && o.appImage)) && o.hasUpdateConfig) {
    return 'auto'
  }
  return 'notice'
}

export interface LatestRelease {
  version: string
  url: string
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/**
 * The newest published release, or null when there is none, the repo is private (404) or GitHub
 * can't be reached. Drafts and pre-releases never show up here.
 */
export async function latestRelease(
  repo: GitHubRepo,
  fetchImpl: Fetch
): Promise<LatestRelease | null> {
  try {
    const res = await fetchImpl(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`,
      {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15_000)
      }
    )
    if (!res.ok) return null
    const json = (await res.json()) as { tag_name?: unknown; html_url?: unknown }
    if (typeof json.tag_name !== 'string' || typeof json.html_url !== 'string') return null
    return { version: json.tag_name.replace(/^v/, ''), url: json.html_url }
  } catch {
    return null
  }
}

export interface UpdateDeps {
  packaged: boolean
  platform: NodeJS.Platform
  appPath: string
  resourcesPath: string
  version: string
  appImage: boolean
  /** electron-updater's check, which downloads and installs on quit. */
  autoUpdate: () => Promise<unknown>
  /** Tells the user a version is out; clicking it opens `url`. */
  notify: (version: string, url: string) => void
  fetch?: Fetch
  setInterval?: (run: () => void, ms: number) => unknown
}

/**
 * Starts looking for updates now and every CHECK_EVERY_MS. Returns the mode it chose. A failed
 * check is quiet: an update is never worth an error dialog.
 */
export function startUpdates(d: UpdateDeps): UpdateMode {
  const pkgPath = join(d.appPath, 'package.json')
  const repo = existsSync(pkgPath)
    ? repoOf(JSON.parse(readFileSync(pkgPath, 'utf8')) as { repository?: unknown })
    : null
  const mode = updateMode({
    packaged: d.packaged,
    platform: d.platform,
    appImage: d.appImage,
    repo,
    hasUpdateConfig: existsSync(join(d.resourcesPath, 'app-update.yml'))
  })
  if (mode === 'off' || !repo) return mode

  const told = new Set<string>()
  const check = async (): Promise<void> => {
    if (mode === 'auto') {
      await d.autoUpdate().catch((err: unknown) => console.warn('Update check failed:', err))
      return
    }
    const latest = await latestRelease(repo, d.fetch ?? fetch)
    if (!latest || !isNewer(latest.version, d.version) || told.has(latest.version)) return
    told.add(latest.version)
    d.notify(latest.version, latest.url)
  }
  void check()
  ;(d.setInterval ?? setInterval)(() => void check(), CHECK_EVERY_MS)
  return mode
}
