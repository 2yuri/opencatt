// Rewrites the update info of DMGs that changed after electron-builder made them.
// release.yml signs, notarizes and staples the DMGs after the build (electron-builder only
// notarizes the .app), and stapling changes their bytes. electron-builder had already written each
// DMG's .blockmap and its sha512 and size in latest-mac.yml, so this recomputes them the same way
// (its own buildBlockMap) and leaves everything else as it was. The ZIPs the updater downloads
// aren't touched.
// Usage: node scripts/refresh-dmg-update-info.mjs release/*.dmg
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'

const builder = createRequire(
  createRequire(import.meta.url).resolve('electron-builder/package.json')
)
const lib = createRequire(builder.resolve('app-builder-lib/package.json'))
const { buildBlockMap } = lib('app-builder-lib/out/targets/blockmap/blockmap')
const { serializeToYaml } = lib('builder-util')
const yaml = lib('js-yaml')

const dmgs = process.argv.slice(2)
if (dmgs.length === 0) {
  console.error('Usage: node scripts/refresh-dmg-update-info.mjs <file.dmg>...')
  process.exit(1)
}

const updateInfoFile = join(dirname(dmgs[0]), 'latest-mac.yml')
const updateInfo = yaml.load(readFileSync(updateInfoFile, 'utf8'))

for (const dmg of dmgs) {
  const { sha512, size } = await buildBlockMap(dmg, 'gzip', `${dmg}.blockmap`)
  const entry = updateInfo.files.find((file) => file.url === basename(dmg))
  if (!entry) throw new Error(`${basename(dmg)} isn't in ${updateInfoFile}`)
  Object.assign(entry, { sha512, size })
  console.log(`${basename(dmg)}: ${size} bytes, sha512 ${sha512}`)
}

writeFileSync(updateInfoFile, serializeToYaml(updateInfo))
