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

  // Smoke 2026-10-06: the chat-list preview showed "@168379948253346" for a sent mention.
  it.fails('replaces @<number> with the resolved mention name from contextInfo.mentions', () => {
    const msg = {
      messageType: 'extendedTextMessage',
      textContent: 'hi @168379948253346 there',
      content: JSON.stringify({
        extendedTextMessage: {
          text: 'hi @168379948253346 there',
          contextInfo: {
            mentionedJid: ['168379948253346@lid'],
            mentions: { '168379948253346@lid': 'Alice' }
          }
        }
      })
    } as MessageItem

    expect(formatMessagePreview(msg)).toBe('hi @Alice there')
  })

  it.fails('resolves mention names in a media caption preview too', () => {
    const msg = {
      messageType: 'imageMessage',
      textContent: 'look @168379948253346',
      content: JSON.stringify({
        imageMessage: {
          caption: 'look @168379948253346',
          contextInfo: { mentions: { '168379948253346@lid': 'Alice' } }
        }
      })
    } as MessageItem

    expect(formatMessagePreview(msg)).toBe('look @Alice')
  })

  it('leaves text untouched when there is no mention data or content is not JSON', () => {
    expect(formatMessagePreview({ messageType: 'conversation', textContent: 'hi @123', content: 'not json' } as MessageItem)).toBe('hi @123')
    expect(formatMessagePreview({ messageType: 'conversation', textContent: 'hi @123' } as MessageItem)).toBe('hi @123')
  })

  it('handles unknown or custom message types gracefully', () => {
    const unknownMsg = { messageType: 'unknown', textContent: 'Fallback text' } as MessageItem
    const customTypeMsg = { messageType: 'locationMessage' as any } as MessageItem

    expect(formatMessagePreview(unknownMsg)).toBe('Fallback text')
    expect(formatMessagePreview(customTypeMsg)).toBe('[locationMessage]')
  })
})
