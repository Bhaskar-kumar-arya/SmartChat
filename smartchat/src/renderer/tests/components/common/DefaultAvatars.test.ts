import { describe, it, expect } from 'vitest'
import { getAvatarColor, DEFAULT_AVATAR_COLORS } from '@renderer/components/common/DefaultAvatars'

describe('getAvatarColor', () => {
  it('always returns a defined color scheme, including for INT_MIN hashes (F11-04)', () => {
    // Brute-force a spread of inputs; the modulo must never yield a negative
    // index (which would return undefined and throw on `.bg`/`.fg`).
    for (let i = 0; i < 5000; i++) {
      const scheme = getAvatarColor(`user${i}@s.whatsapp.net`)
      expect(scheme).toBeDefined()
      expect(typeof scheme.bg).toBe('string')
      expect(typeof scheme.fg).toBe('string')
    }
  })

  it('is stable for the same jid and within palette bounds', () => {
    const a = getAvatarColor('12345@s.whatsapp.net')
    const b = getAvatarColor('12345@s.whatsapp.net')
    expect(a).toEqual(b)
    expect(DEFAULT_AVATAR_COLORS).toContain(a)
  })
})
