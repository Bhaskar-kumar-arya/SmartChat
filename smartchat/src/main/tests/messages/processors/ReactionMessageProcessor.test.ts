import { describe, it, expect, vi } from 'vitest'
import { ReactionMessageProcessor } from '../../../services/messages/processors/ReactionMessageProcessor'
import { IMessageProcessingContext, IMessageProcessorStrategy, IMessageServiceDependencyAccessor } from '../../../services/messages/processors/IMessageProcessorStrategy'

describe('ReactionMessageProcessor', () => {
  const processor: IMessageProcessorStrategy = new ReactionMessageProcessor()

  it('should requireChat to be true', () => {
    expect(processor.requiresChat).toBe(true)
  })

  it('should support reactionMessage types with rawMessage', () => {
    expect(processor.supports({ messageType: 'reactionMessage', rawMessage: {} } as any)).toBe(true)
    expect(processor.supports({ messageType: 'reactionMessage' } as any)).toBe(false)
    expect(processor.supports({ messageType: 'conversation', rawMessage: {} } as any)).toBe(false)
  })

  // R-MSG-06: messages.reaction -> MessageService.processReaction is the single writer.
  it('only classifies the message: returns null and persists nothing (fromMe or not)', async () => {
    const upsertReaction = vi.fn().mockResolvedValue(undefined)
    const dependencies = {
      reactionRepository: { upsertReaction },
      identityRepository: { findMeIdentity: vi.fn().mockResolvedValue({ id: 99 }) }
    } as unknown as IMessageServiceDependencyAccessor

    for (const fromMe of [false, true]) {
      const context = {
        messageType: 'reactionMessage',
        remoteJid: 'user@s.whatsapp.net',
        senderId: fromMe ? null : 10,
        timestamp: 1600000000n,
        msg: { key: { id: 'msg-1', fromMe }, status: 2 },
        rawMessage: { reactionMessage: { key: { id: 'target-1' }, text: '👍' } }
      } as unknown as IMessageProcessingContext

      expect(await processor.process(context, dependencies)).toBeNull()
    }
    expect(upsertReaction).not.toHaveBeenCalled()
  })
})
