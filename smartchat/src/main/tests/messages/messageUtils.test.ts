import { describe, it, expect } from 'vitest'
import {
  unwrapMessage,
  extractContextInfoFromContent,
  preserveContextInfo,
  preserveLocalUri,
  isIndexableMessageType,
  normalizeMuteExpirationSeconds,
  applyEdit,
  mergeContextInfo,
  classifyStub,
  classifyProtocolType,
  extractEditedText,
  CIPHERTEXT_PLACEHOLDER_TEXT
} from '../../utils/messageUtils'
import { patchEditedText } from '../../services/messages/patchEditedText'

describe('messageUtils Unit Tests', () => {
  describe('normalizeMuteExpirationSeconds (P2-S4-02)', () => {
    it('passes through second-scale values unchanged', () => {
      expect(normalizeMuteExpirationSeconds(1_700_000_000)).toBe(1_700_000_000n)
      expect(normalizeMuteExpirationSeconds(1_700_000_000n)).toBe(1_700_000_000n)
    })
    it('converts millisecond-scale values to seconds', () => {
      expect(normalizeMuteExpirationSeconds(1_700_000_000_000)).toBe(1_700_000_000n)
      expect(normalizeMuteExpirationSeconds(1_700_000_000_000n)).toBe(1_700_000_000n)
    })
    it('preserves the -1 "muted forever" sentinel and handles null/undefined/0', () => {
      expect(normalizeMuteExpirationSeconds(-1)).toBe(-1n)
      expect(normalizeMuteExpirationSeconds(null)).toBe(0n)
      expect(normalizeMuteExpirationSeconds(undefined)).toBe(0n)
      expect(normalizeMuteExpirationSeconds(0)).toBe(0n)
    })
  })

  describe('isIndexableMessageType (P2-S2-01)', () => {
    it('excludes ciphertext / system / reaction / protocol / unknown', () => {
      expect(isIndexableMessageType('ciphertext')).toBe(false)
      expect(isIndexableMessageType('system')).toBe(false)
      expect(isIndexableMessageType('reactionMessage')).toBe(false)
      expect(isIndexableMessageType('protocolMessage')).toBe(false)
      expect(isIndexableMessageType('unknown')).toBe(false)
      expect(isIndexableMessageType(null)).toBe(false)
      expect(isIndexableMessageType(undefined)).toBe(false)
    })

    it('includes real text message types', () => {
      expect(isIndexableMessageType('conversation')).toBe(true)
      expect(isIndexableMessageType('extendedTextMessage')).toBe(true)
      expect(isIndexableMessageType('imageMessage')).toBe(true)
    })
  })

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

describe('edit helpers (F-MSG-1)', () => {
  const quote = { stanzaId: 's1', quotedMessage: { conversation: 'q' } }
  const mci = { deviceListMetadata: { senderKeyHash: 'h' } }

  it('mergeContextInfo: null when both empty, incoming wins otherwise', () => {
    expect(mergeContextInfo(null, undefined)).toBeNull()
    expect(mergeContextInfo({ a: 1, b: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 })
  })

  it('applyEdit: unwraps the editedMessage echo and keeps quote + messageContextInfo', () => {
    const existing = { extendedTextMessage: { text: 'old', contextInfo: quote }, messageContextInfo: mci }
    const r = applyEdit(existing, { editedMessage: { message: { conversation: 'new' } } }, 'new')
    expect(r.messageType).toBe('extendedTextMessage')
    expect(r.textContent).toBe('new')
    expect(r.content).toEqual({ extendedTextMessage: { text: 'new', contextInfo: quote }, messageContextInfo: mci })
  })

  it('applyEdit: plain edit without any context stays a conversation', () => {
    const r = applyEdit({ conversation: 'old' }, { conversation: 'new' }, 'new')
    expect(r).toEqual({ content: { conversation: 'new' }, messageType: 'conversation', textContent: 'new' })
  })

  it('applyEdit: caption edit patches the existing media message and its quote', () => {
    const existing = { imageMessage: { mediaKey: 'K', caption: 'old', contextInfo: quote } }
    const r = applyEdit(existing, { imageMessage: { caption: 'new' } }, 'new')
    expect(r.messageType).toBe('imageMessage')
    expect(r.content).toEqual({ imageMessage: { mediaKey: 'K', caption: 'new', contextInfo: quote } })
  })

  it('applyEdit does not mutate its inputs', () => {
    const existing = { extendedTextMessage: { text: 'old', contextInfo: quote } }
    const edited = { editedMessage: { message: { conversation: 'new' } } }
    const before = JSON.stringify([existing, edited])
    applyEdit(existing, edited, 'new')
    expect(JSON.stringify([existing, edited])).toBe(before)
  })

  it('preserveContextInfo: echo with partial contextInfo keeps the quote and text', () => {
    const existing = JSON.stringify({ extendedTextMessage: { text: 'old', contextInfo: quote }, messageContextInfo: mci })
    const echo = JSON.stringify({
      editedMessage: { message: { extendedTextMessage: { text: 'new', contextInfo: { expiration: 5 } } } }
    })
    const out = JSON.parse(preserveContextInfo(existing, echo))
    expect(out.extendedTextMessage.text).toBe('new')
    expect(out.extendedTextMessage.contextInfo).toEqual({ ...quote, expiration: 5 })
    expect(out.messageContextInfo).toEqual(mci)
    expect(out.editedMessage).toBeUndefined()
  })

  it('unwrapMessage does not mutate the input when copying outer contextInfo', () => {
    const msg = {
      extendedTextMessage: { contextInfo: quote },
      ephemeralMessage: { message: { extendedTextMessage: { text: 'x' } } }
    }
    const before = JSON.stringify(msg)
    const out = unwrapMessage(msg)
    expect(JSON.stringify(msg)).toBe(before)
    expect(out.extendedTextMessage?.contextInfo).toEqual(quote)
  })

  it('patchEditedText rewrites text in place', () => {
    expect(JSON.parse(patchEditedText('{"conversation":"a"}', 'b'))).toEqual({ conversation: 'b' })
    expect(JSON.parse(patchEditedText('{"imageMessage":{"caption":"a"}}', 'b'))).toEqual({ imageMessage: { caption: 'b' } })
  })
})

describe('R-MSG-08 shared parsing helpers', () => {
  it('classifyStub', () => {
    expect(classifyStub(undefined)).toBeNull()
    expect(classifyStub(null)).toBeNull()
    expect(classifyStub(1)).toEqual({ kind: 'revoke' })
    expect(classifyStub(2)).toEqual({ kind: 'ciphertext', messageType: 'ciphertext', textContent: CIPHERTEXT_PLACEHOLDER_TEXT })
    expect(classifyStub(99999, ['a'])).toEqual({ kind: 'system', messageType: 'system', content: { stubType: 'UNKNOWN', parameters: ['a'] } })
    expect(classifyStub('X')).toEqual({ kind: 'system', messageType: 'system', content: { stubType: 'X', parameters: [] } })
  })
  it('classifyProtocolType', () => {
    expect([0, 'REVOKE'].map(classifyProtocolType)).toEqual(['revoke', 'revoke'])
    expect([14, 'MESSAGE_EDIT'].map(classifyProtocolType)).toEqual(['edit', 'edit'])
    expect([3, undefined, 'x'].map(classifyProtocolType)).toEqual([null, null, null])
  })
  it('extractEditedText: ?? by default, || with skipEmpty', () => {
    const m = { conversation: '', extendedTextMessage: { text: 'x' } }
    expect(extractEditedText(m)).toBe('')
    expect(extractEditedText(m, { skipEmpty: true })).toBe('x')
    expect(extractEditedText(null)).toBeNull()
    expect(extractEditedText({}, { skipEmpty: true })).toBeNull()
  })
})
