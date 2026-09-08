import { describe, it, expect } from 'vitest'
import { join, resolve, sep } from 'path'
import { app } from 'electron'
import { LocalFileStorage } from '../../services/storage/LocalFileStorage'

describe('LocalFileStorage.resolveMediaPath — path containment (P2-S12-03)', () => {
  const storage = new LocalFileStorage()
  const mediaDir = resolve(join(app.getPath('userData'), 'media'))

  it('resolves a plain media file inside the media directory', () => {
    expect(storage.resolveMediaPath('app://media/photo.jpg')).toBe(join(mediaDir, 'photo.jpg'))
  })

  it('passes through a raw non-app:// path unchanged', () => {
    expect(storage.resolveMediaPath('/some/abs/file.png')).toBe('/some/abs/file.png')
  })

  it('rejects a back-slash traversal that the naive replace() would have kept', () => {
    expect(() => storage.resolveMediaPath('app://media/..\\..\\..\\Users\\me\\Desktop\\x.exe')).toThrow()
  })

  it('rejects a forward-slash traversal', () => {
    expect(() => storage.resolveMediaPath('app://media/../favourites/secret.bin')).toThrow()
  })

  it('rejects an encoded separator', () => {
    expect(() => storage.resolveMediaPath('app://media/%2e%2e%2fescape')).toThrow()
  })

  it('keeps the favourites variant contained', () => {
    const favDir = resolve(join(app.getPath('userData'), 'favourites'))
    expect(storage.resolveMediaPath('app://favourites/s.webp')).toBe(favDir + sep + 's.webp')
  })
})
