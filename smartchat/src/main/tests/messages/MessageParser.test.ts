import { describe, it, expect } from 'vitest'
import { MessageParser } from '../../services/messages/MessageParser'

describe('MessageParser', () => {
  const parser = new MessageParser()

  it('should identify special messages', () => {
    expect(parser.isSpecialMessage({ message: { protocolMessage: {} } } as any)).toBe(true)
    expect(parser.isSpecialMessage({ message: { reactionMessage: {} } } as any)).toBe(true)
    expect(parser.isSpecialMessage({ message: { secretEncryptedMessage: {} } } as any)).toBe(true)
    expect(parser.isSpecialMessage({ message: { encReactionMessage: {} } } as any)).toBe(true)
    
    expect(parser.isSpecialMessage({ message: { conversation: 'hello' } } as any)).toBe(false)
  })

  it('should return null for messages without key id', () => {
    expect(parser.parseMessageSync({ key: {} } as any)).toBeNull()
    expect(parser.parseMessageSync({} as any)).toBeNull()
  })

  it('should return null for special messages during sync parse', () => {
    const msg = {
      key: { id: '123' },
      message: { reactionMessage: {} }
    }
    expect(parser.parseMessageSync(msg as any)).toBeNull()
  })

  it('should extract text content from various message types', () => {
    expect(parser.extractTextContent({ conversation: 'hello' })).toBe('hello')
    expect(parser.extractTextContent({ extendedTextMessage: { text: 'world' } })).toBe('world')
    expect(parser.extractTextContent({ imageMessage: { caption: 'an image' } })).toBe('an image')
    expect(parser.extractTextContent({ stickerMessage: {} })).toBeNull()
    expect(parser.extractTextContent(null)).toBeNull()
  })

  it('should parse a standard message into a ParsedMessage DTO', () => {
    const msg = {
      key: {
        id: 'msg-123',
        remoteJid: 'user@s.whatsapp.net',
        fromMe: false,
      },
      message: { conversation: 'hello there' },
      messageTimestamp: 1600000000,
      pushName: 'Alice'
    }

    const parsed = parser.parseMessageSync(msg as any)
    expect(parsed).not.toBeNull()
    expect(parsed?.id).toBe('msg-123')
    expect(parsed?.chatJid).toBe('user@s.whatsapp.net')
    expect(parsed?.fromMe).toBe(false)
    expect(parsed?.textContent).toBe('hello there')
    expect(parsed?.pushName).toBe('Alice')
    expect(parsed?.timestamp).toBe(1600000000n)
    expect(parsed?.messageType).toBe('conversation')
    expect(parsed?.isDeleted).toBe(false)
  })
})
