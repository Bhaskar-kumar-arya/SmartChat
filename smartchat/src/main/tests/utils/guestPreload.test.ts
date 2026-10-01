import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { isAllowedGuestPreload } from '../../utils/guestPreload'

const dir = join(process.cwd(), 'out', 'preload')

describe('isAllowedGuestPreload', () => {
  it('accepts the panel and overlay preloads as file:// URLs (what the renderer passes)', () => {
    expect(isAllowedGuestPreload(pathToFileURL(join(dir, 'panel-preload.js')).href, dir)).toBe(true)
    expect(isAllowedGuestPreload(pathToFileURL(join(dir, 'overlay-preload.js')).href, dir)).toBe(true)
  })

  it('accepts raw filesystem paths', () => {
    expect(isAllowedGuestPreload(join(dir, 'panel-preload.js'), dir)).toBe(true)
  })

  it('rejects any other preload', () => {
    expect(isAllowedGuestPreload(pathToFileURL(join(dir, 'evil.js')).href, dir)).toBe(false)
    expect(isAllowedGuestPreload('file:///tmp/panel-preload.js', dir)).toBe(false)
  })
})
