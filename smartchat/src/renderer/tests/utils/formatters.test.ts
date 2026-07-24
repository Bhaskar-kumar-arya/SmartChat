import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatTime,
  formatDate,
  formatChatTime,
  isMuted,
  formatReceiptTime,
  formatReceiptDate,
  formatSenderName
} from '@renderer/utils/formatters'

describe('formatters utility', () => {
  describe('formatTime', () => {
    it('formats Unix timestamp string into time string', () => {
      // 1672531200 = 2023-01-01T00:00:00.000Z
      const result = formatTime('1672531200')
      expect(result).toMatch(/\d{1,2}:\d{2}/)
    })

    it('returns empty string for invalid timestamp strings', () => {
      expect(formatTime('invalid')).toBe('')
    })
  })

  describe('formatDate', () => {
    beforeEach(() => {
      // Mock Date.now / system time to a fixed date: 2026-05-15 12:00:00 UTC
      const mockNow = new Date('2026-05-15T12:00:00Z')
      vi.useFakeTimers()
      vi.setSystemTime(mockNow)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns "Today" for current date timestamp', () => {
      const todaySec = Math.floor(new Date('2026-05-15T08:30:00Z').getTime() / 1000).toString()
      expect(formatDate(todaySec)).toBe('Today')
    })

    it('returns "Yesterday" for previous day timestamp', () => {
      const yesterdaySec = Math.floor(new Date('2026-05-14T15:00:00Z').getTime() / 1000).toString()
      expect(formatDate(yesterdaySec)).toBe('Yesterday')
    })

    it('returns long formatted date for older timestamps', () => {
      const olderSec = Math.floor(new Date('2026-01-01T10:00:00Z').getTime() / 1000).toString()
      const formatted = formatDate(olderSec)
      expect(formatted).not.toBe('Today')
      expect(formatted).not.toBe('Yesterday')
      expect(formatted.length).toBeGreaterThan(0)
    })

    it('returns empty string for invalid timestamp', () => {
      expect(formatDate('not-a-number')).toBe('')
    })
  })

  describe('formatChatTime', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-15T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns 2-digit time format for today', () => {
      const todaySec = Math.floor(new Date('2026-05-15T10:00:00Z').getTime() / 1000).toString()
      expect(formatChatTime(todaySec)).toMatch(/\d{1,2}:\d{2}/)
    })

    it('returns "Yesterday" for yesterday', () => {
      const yesterdaySec = Math.floor(new Date('2026-05-14T10:00:00Z').getTime() / 1000).toString()
      expect(formatChatTime(yesterdaySec)).toBe('Yesterday')
    })

    it('returns short month/day format for older dates', () => {
      const olderSec = Math.floor(new Date('2026-04-10T10:00:00Z').getTime() / 1000).toString()
      expect(formatChatTime(olderSec)).toMatch(/Apr|10/)
    })

    it('returns empty string on error', () => {
      expect(formatChatTime('abc')).toBe('')
    })
  })

  describe('isMuted', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-05-15T12:00:00.000Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns false if expiration is missing or empty', () => {
      expect(isMuted(undefined)).toBe(false)
      expect(isMuted('')).toBe(false)
    })

    it('returns true for permanent mute (-1 expiration seconds)', () => {
      expect(isMuted('-1')).toBe(true)
    })

    it('returns true if expiration timestamp is in the future', () => {
      const futureSec = Math.floor(Date.now() / 1000) + 3600
      expect(isMuted(futureSec.toString())).toBe(true)
    })

    it('returns false if expiration timestamp is in the past or zero', () => {
      const pastSec = Math.floor(Date.now() / 1000) - 3600
      expect(isMuted(pastSec.toString())).toBe(false)
      expect(isMuted('0')).toBe(false)
    })
  })

  describe('formatReceiptTime and formatReceiptDate', () => {
    it('formats valid receipt time and date', () => {
      const ts = '1672531200'
      expect(formatReceiptTime(ts)).toMatch(/\d{1,2}:\d{2}/)
      expect(formatReceiptDate(ts)).toMatch(/2023/)
    })

    it('handles NaN and invalid inputs gracefully', () => {
      expect(formatReceiptTime('invalid')).toBe('')
      expect(formatReceiptDate('invalid')).toBe('')
    })
  })

  describe('formatSenderName', () => {
    it('returns "You" if message is from user', () => {
      expect(formatSenderName(true, 'Alice', '12345@s.whatsapp.net')).toBe('You')
    })

    it('returns participantName if provided and not fromMe', () => {
      expect(formatSenderName(false, 'Alice', '12345@s.whatsapp.net')).toBe('Alice')
    })

    it('extracts username from participant JID if participantName is missing', () => {
      expect(formatSenderName(false, null, '12345@s.whatsapp.net')).toBe('12345')
      expect(formatSenderName(false, '', '98765:2@s.whatsapp.net')).toBe('98765:2')
    })

    it('returns fallback if participantName and participant are both missing', () => {
      expect(formatSenderName(false, null, null, 'Someone')).toBe('Someone')
      expect(formatSenderName(false, undefined, undefined, null)).toBe(null)
    })
  })
})
