import { describe, it, expect } from 'vitest'
import { fuzzyScore, filterAndRank } from '@renderer/utils/mentionUtils'
import { ChatItem } from '@renderer/types/chat.types'

describe('mentionUtils utility', () => {
  describe('fuzzyScore', () => {
    it('returns 100 when query is empty', () => {
      expect(fuzzyScore('', 'Alice')).toBe(100)
    })

    it('returns score > 200 for exact substring match', () => {
      const scoreStart = fuzzyScore('ali', 'Alice')
      const scoreMiddle = fuzzyScore('lic', 'Alice')
      expect(scoreStart).toBeGreaterThan(200)
      expect(scoreMiddle).toBeGreaterThan(200)
      // Word boundary match (idx === 0) should score higher than middle substring
      expect(scoreStart).toBeGreaterThan(scoreMiddle)
    })

    it('returns positive score for non-contiguous fuzzy character sequence', () => {
      const score = fuzzyScore('alc', 'Alice')
      expect(score).toBeGreaterThan(0)
      expect(score).toBeLessThan(200)
    })

    it('returns -1 when query characters do not match target in sequence', () => {
      expect(fuzzyScore('xyz', 'Alice')).toBe(-1)
      expect(fuzzyScore('ca', 'Alice')).toBe(-1)
    })

    it('is case-insensitive', () => {
      expect(fuzzyScore('ALICE', 'alice')).toBeGreaterThan(200)
    })
  })

  describe('filterAndRank', () => {
    const mockChats: ChatItem[] = [
      { jid: '111@s.whatsapp.net', name: 'Bob Marley', pushName: 'Bob' } as any,
      { jid: '222@s.whatsapp.net', name: 'Alice Smith', pushName: 'Ali' } as any,
      { jid: '333@s.whatsapp.net', name: 'Charlie Brown', pushName: 'Chuck' } as any,
      { jid: '444@s.whatsapp.net', name: undefined, pushName: undefined } as any,
    ]

    it('returns top limit items when query is empty', () => {
      const result = filterAndRank(mockChats, '', 2)
      expect(result).toHaveLength(2)
      expect(result[0].jid).toBe('111@s.whatsapp.net')
    })

    it('filters and ranks items matching name or pushName', () => {
      const result = filterAndRank(mockChats, 'ali')
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].name).toBe('Alice Smith')
    })

    it('falls back to JID prefix when name and pushName are missing', () => {
      const result = filterAndRank(mockChats, '444')
      expect(result).toHaveLength(1)
      expect(result[0].jid).toBe('444@s.whatsapp.net')
    })

    it('returns empty array when no items match query', () => {
      const result = filterAndRank(mockChats, 'nonexistent')
      expect(result).toHaveLength(0)
    })
  })
})
