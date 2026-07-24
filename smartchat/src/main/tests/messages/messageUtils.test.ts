import { describe, it, expect } from 'vitest'
import {
  unwrapMessage,
  extractContextInfoFromContent,
  preserveContextInfo,
  preserveLocalUri
} from '../../utils/messageUtils'

describe('messageUtils Unit Tests', () => {
  describe('unwrapMessage', () => {
    it('should return empty object when null or undefined', () => {
      expect(unwrapMessage(null)).toEqual({})
      expect(unwrapMessage(undefined)).toEqual({})
    })

    it('should return plain message unchanged', () => {
      const msg = { conversation: 'hello' }
      expect(unwrapMessage(msg)).toEqual({ conversation: 'hello' })
    })

    it('should unwrap editedMessage container', () => {
      const msg = {
        editedMessage: {
          message: {
            conversation: 'edited text'
          }
        }
      }
      expect(unwrapMessage(msg as any)).toEqual({ conversation: 'edited text' })
    })

    it('should preserve outer contextInfo when unwrapping editedMessage container', () => {
      const msg = {
        extendedTextMessage: {
          text: 'reply msg',
          contextInfo: {
            stanzaId: 'orig_123',
            participant: 'alice@s.whatsapp.net',
            quotedMessage: { conversation: 'question?' }
          }
        },
        editedMessage: {
          message: {
            conversation: 'edited text'
          }
        }
      }
      const unwrapped = unwrapMessage(msg as any)
      expect((unwrapped as any).contextInfo?.stanzaId).toBe('orig_123')
    })
  })

  describe('extractContextInfoFromContent', () => {
    it('should extract contextInfo from extendedTextMessage', () => {
      const parsed = {
        extendedTextMessage: {
          text: 'reply msg',
          contextInfo: {
            stanzaId: 'stanza_1',
            participant: 'bob@s.whatsapp.net'
          }
        }
      }
      const ctx = extractContextInfoFromContent(parsed)
      expect(ctx?.stanzaId).toBe('stanza_1')
      expect(ctx?.participant).toBe('bob@s.whatsapp.net')
    })

    it('should extract contextInfo from wrapped editedMessage container', () => {
      const parsed = {
        editedMessage: {
          message: {
            extendedTextMessage: {
              text: 'edited reply',
              contextInfo: {
                stanzaId: 'stanza_2',
                participant: 'carol@s.whatsapp.net'
              }
            }
          }
        }
      }
      const ctx = extractContextInfoFromContent(parsed)
      expect(ctx?.stanzaId).toBe('stanza_2')
      expect(ctx?.participant).toBe('carol@s.whatsapp.net')
    })
  })

  describe('preserveContextInfo', () => {
    it('should merge original contextInfo when editing message with conversation payload', () => {
      const existingJson = JSON.stringify({
        extendedTextMessage: {
          text: 'orig reply',
          contextInfo: {
            stanzaId: 'q_1',
            participant: 'dave@s.whatsapp.net',
            quotedMessage: { conversation: 'what is this?' }
          }
        }
      })
      const newContent = JSON.stringify({ conversation: 'new text' })

      const resultJson = preserveContextInfo(existingJson, newContent)
      const result = JSON.parse(resultJson)

      expect(result.extendedTextMessage?.text).toBe('new text')
      expect(result.extendedTextMessage?.contextInfo?.stanzaId).toBe('q_1')
      expect(result.extendedTextMessage?.contextInfo?.quotedMessage?.conversation).toBe('what is this?')
      expect(result.conversation).toBeUndefined()
    })
  })

  describe('preserveLocalUri', () => {
    it('should retain localURI on media message when updated from network payload', () => {
      const existingJson = JSON.stringify({
        imageMessage: {
          url: 'https://wa.media/1',
          localURI: 'file:///local/cached.jpg'
        }
      })
      const newContent = JSON.stringify({
        imageMessage: {
          url: 'https://wa.media/1_updated'
        }
      })

      const resultJson = preserveLocalUri(existingJson, newContent)
      const result = JSON.parse(resultJson)

      expect(result.imageMessage?.localURI).toBe('file:///local/cached.jpg')
    })
  })
})
