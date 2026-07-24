import { describe, it, expect } from 'vitest'
import { getPresenceStatusText } from '@renderer/utils/presenceUtils'
import { ChatItem } from '@renderer/types/chat.types'
import { PresenceMap } from '@renderer/types/presence.types'

describe('presenceUtils utility', () => {
  const directChat = { jid: '12345@s.whatsapp.net' } as ChatItem
  const groupChat = { jid: '12345@g.us' } as ChatItem

  it('returns null if presence map is undefined or empty', () => {
    expect(getPresenceStatusText(directChat, undefined)).toBeNull()
    expect(getPresenceStatusText(directChat, {})).toBeNull()
  })

  it('returns "typing..." for direct chat when user is composing', () => {
    const presence: PresenceMap = {
      '12345@s.whatsapp.net': { lastKnownPresence: 'composing' } as any,
    }
    expect(getPresenceStatusText(directChat, presence)).toBe('typing...')
  })

  it('returns "recording..." for direct chat when user is recording', () => {
    const presence: PresenceMap = {
      '12345@s.whatsapp.net': { lastKnownPresence: 'recording' } as any,
    }
    expect(getPresenceStatusText(directChat, presence)).toBe('recording...')
  })

  it('formats group typing status with participant name or count', () => {
    const singleTypingWithName: PresenceMap = {
      'p1@s.whatsapp.net': { lastKnownPresence: 'composing', name: 'Alice' } as any,
    }
    expect(getPresenceStatusText(groupChat, singleTypingWithName)).toBe('Alice typing...')

    const singleTypingNoName: PresenceMap = {
      'p1@s.whatsapp.net': { lastKnownPresence: 'composing' } as any,
    }
    expect(getPresenceStatusText(groupChat, singleTypingNoName)).toBe('p1 typing...')

    const multiTyping: PresenceMap = {
      'p1@s.whatsapp.net': { lastKnownPresence: 'composing', name: 'Alice' } as any,
      'p2@s.whatsapp.net': { lastKnownPresence: 'composing', name: 'Bob' } as any,
    }
    expect(getPresenceStatusText(groupChat, multiTyping)).toBe('2 typing...')
  })

  it('formats group recording status with participant name or count', () => {
    const singleRecording: PresenceMap = {
      'p1@s.whatsapp.net': { lastKnownPresence: 'recording', name: 'Bob' } as any,
    }
    expect(getPresenceStatusText(groupChat, singleRecording)).toBe('Bob recording...')

    const multiRecording: PresenceMap = {
      'p1@s.whatsapp.net': { lastKnownPresence: 'recording' } as any,
      'p2@s.whatsapp.net': { lastKnownPresence: 'recording' } as any,
      'p3@s.whatsapp.net': { lastKnownPresence: 'recording' } as any,
    }
    expect(getPresenceStatusText(groupChat, multiRecording)).toBe('3 recording...')
  })
})
