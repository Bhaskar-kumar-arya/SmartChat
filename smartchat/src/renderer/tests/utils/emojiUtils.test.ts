import { describe, it, expect } from 'vitest'
import { emojiToUnified } from '@renderer/utils/emojiUtils'

describe('emojiUtils utility', () => {
  it('converts single codepoint Unicode emoji to lowercase hex unified format', () => {
    expect(emojiToUnified('😊')).toBe('1f60a')
    expect(emojiToUnified('🚀')).toBe('1f680')
  })

  it('converts complex multi-codepoint emojis joined by ZWJ', () => {
    expect(emojiToUnified('👨‍👩‍👧')).toBe('1f468-200d-1f469-200d-1f467')
  })

  it('converts emojis with variation selectors', () => {
    expect(emojiToUnified('❤️')).toBe('2764-fe0f')
  })

  it('returns empty string for empty input', () => {
    expect(emojiToUnified('')).toBe('')
  })
})
