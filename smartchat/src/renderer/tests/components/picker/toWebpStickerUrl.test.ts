import { describe, it, expect } from 'vitest'
import { toWebpStickerUrl } from '@renderer/components/picker/EmojiStickerGifPicker'

describe('toWebpStickerUrl (F6-08)', () => {
  it('rewrites a trailing .gif extension', () => {
    expect(toWebpStickerUrl('https://cdn.example.com/pack/hello.gif')).toBe(
      'https://cdn.example.com/pack/hello.webp'
    )
  })

  it('rewrites .gif before a query string or hash', () => {
    expect(toWebpStickerUrl('https://cdn.example.com/a.gif?v=2')).toBe(
      'https://cdn.example.com/a.webp?v=2'
    )
    expect(toWebpStickerUrl('https://cdn.example.com/a.gif#frag')).toBe(
      'https://cdn.example.com/a.webp#frag'
    )
  })

  it('leaves an already-webp URL untouched', () => {
    expect(toWebpStickerUrl('https://cdn.example.com/a.webp')).toBe(
      'https://cdn.example.com/a.webp'
    )
  })

  it('does not touch .gif that only appears in a query param', () => {
    expect(toWebpStickerUrl('https://cdn.example.com/render?src=cat.gif')).toBe(
      'https://cdn.example.com/render?src=cat.gif'
    )
  })

  it('leaves an extensionless CDN path untouched', () => {
    expect(toWebpStickerUrl('https://cdn.example.com/stickers/12345')).toBe(
      'https://cdn.example.com/stickers/12345'
    )
  })
})
