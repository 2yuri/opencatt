import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PastedFiles } from './pasted'
import { tempDir } from './testFiles'

describe('PastedFiles (OP-89)', () => {
  it('saves a pasted image with the extension import() expects, and removes it once released', () => {
    const dir = join(tempDir(), 'pasted')
    const pasted = new PastedFiles(dir)
    const path = pasted.save(new Uint8Array([1, 2, 3]), 'image/png')

    expect(path.startsWith(dir)).toBe(true)
    expect(path.endsWith('.png')).toBe(true)
    expect([...readFileSync(path)]).toEqual([1, 2, 3])
    expect(pasted.save(new Uint8Array([1]), 'video/quicktime').endsWith('.mov')).toBe(true)

    pasted.release([path])
    expect(existsSync(path)).toBe(false)
  })

  it("refuses what X can't take, and never releases a file of the user's", () => {
    const root = tempDir()
    const pasted = new PastedFiles(join(root, 'pasted'))
    expect(() => pasted.save(new Uint8Array([1]), 'application/pdf')).toThrow(
      "OpenCatt can't add that kind of file."
    )
    expect(() => pasted.save(new Uint8Array(), 'image/png')).toThrow('The pasted file is empty.')

    const own = join(root, 'photo.png')
    writeFileSync(own, 'x')
    pasted.release([own])
    expect(existsSync(own)).toBe(true)
  })

  it('clears what a paste left behind on startup', () => {
    const dir = join(tempDir(), 'pasted')
    const pasted = new PastedFiles(dir)
    const path = pasted.save(new Uint8Array([1]), 'image/gif')
    pasted.sweep()
    expect(existsSync(path)).toBe(false)
  })
})
