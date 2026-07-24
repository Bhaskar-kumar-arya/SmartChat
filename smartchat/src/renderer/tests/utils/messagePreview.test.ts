import { describe, it, expect } from 'vitest'
import { formatMessagePreview } from '@renderer/utils/messagePreview'
import { MessageItem } from '@renderer/types/message.types'

describe('messagePreview utility', () => {
  it('returns "Sticker" for sticker message types', () => {
    const msg1 = { messageType: 'stickerMessage' } as MessageItem
    const msg2 = { messageType: 'lottieStickerMessage' } as MessageItem

    expect(formatMessagePreview(msg1)).toBe('Sticker')
    expect(formatMessagePreview(msg2)).toBe('Sticker')
  })

  it('returns textContent or default fallback for photo and video messages', () => {
    const imgMsg = { messageType: 'imageMessage', textContent: 'Check this out' } as MessageItem
    const imgNoText = { messageType: 'imageMessage' } as MessageItem
    const vidNoText = { messageType: 'videoMessage' } as MessageItem

    expect(formatMessagePreview(imgMsg)).toBe('Check this out')
    expect(formatMessagePreview(imgNoText)).toBe('Photo')
    expect(formatMessagePreview(vidNoText)).toBe('Video')
  })

  it('returns "Voice message" for audioMessage', () => {
    const audioMsg = { messageType: 'audioMessage' } as MessageItem
    expect(formatMessagePreview(audioMsg)).toBe('Voice message')
  })

  it('returns textContent for text conversations and extendedTextMessage', () => {
    const textMsg = { messageType: 'conversation', textContent: 'Hello world' } as MessageItem
    const extMsg = { messageType: 'extendedTextMessage', textContent: 'Extended text' } as MessageItem

    expect(formatMessagePreview(textMsg)).toBe('Hello world')
    expect(formatMessagePreview(extMsg)).toBe('Extended text')
  })

  it('handles unknown or custom message types gracefully', () => {
    const unknownMsg = { messageType: 'unknown', textContent: 'Fallback text' } as MessageItem
    const customTypeMsg = { messageType: 'locationMessage' as any } as MessageItem

    expect(formatMessagePreview(unknownMsg)).toBe('Fallback text')
    expect(formatMessagePreview(customTypeMsg)).toBe('[locationMessage]')
  })
})
