import { describe, it, expect } from 'vitest'
import { isSameJid } from '@renderer/utils/jidUtils'

describe('jidUtils utility', () => {
  describe('isSameJid', () => {
    it('returns true for identical phone number JIDs', () => {
      expect(isSameJid('1234567890@s.whatsapp.net', '1234567890@s.whatsapp.net')).toBe(true)
    })

    it('returns true when comparing LID and phone number JIDs with matching identifier', () => {
      expect(isSameJid('1234567890@s.whatsapp.net', '1234567890@lid')).toBe(true)
    })

    it('ignores device suffixes (e.g. :1, :2) when comparing JIDs', () => {
      expect(isSameJid('1234567890:1@s.whatsapp.net', '1234567890:3@lid')).toBe(true)
      expect(isSameJid('9999:0@g.us', '9999@g.us')).toBe(true)
    })

    it('returns false for non-matching JIDs', () => {
      expect(isSameJid('11111@s.whatsapp.net', '22222@s.whatsapp.net')).toBe(false)
      expect(isSameJid('11111@lid', '22222@lid')).toBe(false)
    })

    it('returns false when either JID is null or undefined or empty', () => {
      expect(isSameJid(null, '12345@s.whatsapp.net')).toBe(false)
      expect(isSameJid('12345@s.whatsapp.net', undefined)).toBe(false)
      expect(isSameJid(undefined, undefined)).toBe(false)
      expect(isSameJid('', '12345@s.whatsapp.net')).toBe(false)
    })
  })
})
