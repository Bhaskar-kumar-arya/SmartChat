import { describe, it, expect, vi } from 'vitest'
import { MessageReactionStrategy } from '../../../services/whatsapp/secret/MessageReactionStrategy'
import { proto } from '@whiskeysockets/baileys'
import { IWAEventBus } from '../../../services/whatsapp/IWAEventBus'
import { ISocketUserContext } from '../../../services/contacts/IContactService'

describe('MessageReactionStrategy', () => {
  it('should return correct secret type and signing label', () => {
    const strategy = new MessageReactionStrategy(() => null)
    expect(strategy.getSecretType()).toBe('encReactionMessage')
    expect(strategy.getSigningLabel()).toBe('Enc Reaction')
  })

  it('should decode reaction message and emit event to bus', async () => {
    const emitMock = vi.fn()
    const getBus = () => ({ emit: emitMock } as unknown as IWAEventBus)
    const strategy = new MessageReactionStrategy(getBus)

    // Create a mock encrypted reaction message payload
    const reactionMessage = {
      text: '👍',
    }
    const decryptedBytes = proto.Message.ReactionMessage.encode(reactionMessage).finish()

    const context = {
      targetId: 'target-123',
      remoteJid: 'remote@g.us',
      fromMe: false,
      senderJid: 'sender@s.whatsapp.net',
      timestamp: 1620000000n
    }
    const sock = { id: 'sock-1' } as unknown as ISocketUserContext

    const result = await strategy.handle(decryptedBytes, context, sock)

    expect(result).toBeNull()
    
    expect(emitMock).toHaveBeenCalledTimes(1)
    expect(emitMock).toHaveBeenCalledWith('reaction:update', {
      reactions: [{
        key: {
          id: 'target-123',
          remoteJid: 'remote@g.us',
          fromMe: false
        },
        reaction: {
          key: {
            id: 'target-123',
            remoteJid: 'remote@g.us',
            fromMe: false,
            participant: 'sender@s.whatsapp.net'
          },
          text: '👍',
          senderTimestampMs: 1620000000000
        }
      }],
      sock
    })
  })

  it('should handle missing bus gracefully', async () => {
    const getBus = () => null
    const strategy = new MessageReactionStrategy(getBus)

    const reactionMessage = {
      text: '👍',
    }
    const decryptedBytes = proto.Message.ReactionMessage.encode(reactionMessage).finish()

    const context = {
      targetId: 'target-123',
      remoteJid: 'remote@g.us',
      fromMe: false,
      senderJid: 'sender@s.whatsapp.net',
      timestamp: 1620000000n
    }

    const result = await strategy.handle(decryptedBytes, context, null)

    expect(result).toBeNull() // Should still return null without crashing
  })

  it('should handle decode errors gracefully', async () => {
    const emitMock = vi.fn()
    const getBus = () => ({ emit: emitMock } as unknown as IWAEventBus)
    const strategy = new MessageReactionStrategy(getBus)

    // Invalid bytes for ReactionMessage decode
    const decryptedBytes = new Uint8Array([99, 99, 99])

    const context = {
      targetId: 'target-123',
      remoteJid: 'remote@g.us',
      fromMe: false,
      senderJid: 'sender@s.whatsapp.net',
      timestamp: 1620000000n
    }

    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await strategy.handle(decryptedBytes, context, null)

    expect(result).toBeNull()
    expect(emitMock).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })
})
