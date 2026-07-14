import { describe, it, expect, vi } from 'vitest'
import { ReactionMessageProcessor } from '../../../services/messages/processors/ReactionMessageProcessor'
import { IMessageProcessingContext, IMessageServiceDependencyAccessor } from '../../../services/messages/processors/IMessageProcessorStrategy'

describe('ReactionMessageProcessor', () => {
  const processor = new ReactionMessageProcessor()

  it('should requireChat to be true', () => {
    expect(processor.requiresChat).toBe(true)
  })

  it('should support reactionMessage types with rawMessage', () => {
    expect(processor.supports({ messageType: 'reactionMessage', rawMessage: {} } as any)).toBe(true)
    expect(processor.supports({ messageType: 'reactionMessage' } as any)).toBe(false)
    expect(processor.supports({ messageType: 'conversation', rawMessage: {} } as any)).toBe(false)
  })

  it('should process reaction message and call upsertReaction', async () => {
    const upsertReactionMock = vi.fn().mockResolvedValue(undefined)
    const findMeIdentityMock = vi.fn().mockResolvedValue(null)

    const dependencies = {
      reactionRepository: {
        upsertReaction: upsertReactionMock
      },
      identityRepository: {
        findMeIdentity: findMeIdentityMock
      }
    } as unknown as IMessageServiceDependencyAccessor

    const context = {
      messageType: 'reactionMessage',
      remoteJid: 'user@s.whatsapp.net',
      senderId: 10,
      timestamp: 1600000000n,
      msg: {
        key: { id: 'msg-123', fromMe: false },
        status: 2 // DeliveryAck
      },
      rawMessage: {
        reactionMessage: {
          key: { id: 'target-123' },
          text: '👍'
        }
      },
      textContent: null,
      participantString: 'participant@s.whatsapp.net'
    } as unknown as IMessageProcessingContext

    const result = await processor.process(context, dependencies)

    expect(upsertReactionMock).toHaveBeenCalledWith('target-123', 10, '👍', 1600000000n)
    expect(result).toMatchObject({
      id: 'msg-123',
      chatJid: 'user@s.whatsapp.net',
      fromMe: false,
      senderId: 10,
      participant: 'participant@s.whatsapp.net',
      timestamp: 1600000000n,
      messageType: 'reactionMessage',
      isDeleted: false,
      isEdited: false,
      status: 'SENT'
    })
  })

  it('should correctly resolve reactorId when fromMe is true', async () => {
    const upsertReactionMock = vi.fn().mockResolvedValue(undefined)
    const findMeIdentityMock = vi.fn().mockResolvedValue({ id: 99 })

    const dependencies = {
      reactionRepository: {
        upsertReaction: upsertReactionMock
      },
      identityRepository: {
        findMeIdentity: findMeIdentityMock
      }
    } as unknown as IMessageServiceDependencyAccessor

    const context = {
      messageType: 'reactionMessage',
      remoteJid: 'user@s.whatsapp.net',
      senderId: null, // Initial senderId might be null for fromMe
      timestamp: 1600000000n,
      msg: {
        key: { id: 'msg-123', fromMe: true },
        status: 2
      },
      rawMessage: {
        reactionMessage: {
          key: { id: 'target-123' },
          text: '❤️'
        }
      }
    } as unknown as IMessageProcessingContext

    await processor.process(context, dependencies)

    expect(findMeIdentityMock).toHaveBeenCalled()
    expect(upsertReactionMock).toHaveBeenCalledWith('target-123', 99, '❤️', 1600000000n)
  })
})
