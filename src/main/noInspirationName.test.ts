import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// OpenCatt never names the product it was inspired by (boss, OP-84). The word is built from two
// halves so this file doesn't trip its own check; longer words that contain it, like "bottom",
// are fine.
const NAME = ['ot', 'to'].join('')
const WHOLE_WORD = new RegExp(`(?<![a-z0-9])${NAME}(?![a-z0-9])`, 'i')
const BINARY = /\.(png|ico|icns|jpe?g|gif|webp|mp4|mov|woff2?|ttf|otf|zip|gz)$/i

const root = join(__dirname, '../..')

describe('the repository', () => {
  it('never names the product OpenCatt was inspired by', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter((file) => file && !BINARY.test(file))
    const hits = files.flatMap((file) =>
      readFileSync(join(root, file), 'utf8')
        .split('\n')
        .flatMap((line, i) => (WHOLE_WORD.test(line) ? [`${file}:${i + 1}`] : []))
    )
    expect(hits).toEqual([])
  })

  it('still lets longer words through', () => {
    expect(WHOLE_WORD.test('bottom: 3px')).toBe(false)
    expect(WHOLE_WORD.test(`a take on ${NAME[0]!.toUpperCase()}${NAME.slice(1)}`)).toBe(true)
  })
})
