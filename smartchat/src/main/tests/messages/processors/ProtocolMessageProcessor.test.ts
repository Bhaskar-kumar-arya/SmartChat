import { describe, it, expect } from 'vitest'
import { ProtocolMessageProcessor } from '../../../services/messages/processors/ProtocolMessageProcessor'
import { IMessageProcessingContext, IMessageServiceDependencyAccessor } from '../../../services/messages/processors/IMessageProcessorStrategy'

describe('ProtocolMessageProcessor', () => {
  const processor = new ProtocolMessageProcessor()

  it('should requireChat to be false', () => {
    expect(processor.requiresChat).toBe(false)
  })

  it('should support protocolMessage types with unwrapped content', () => {
    expect(processor.supports({ messageType: 'protocolMessage', unwrapped: {} } as any)).toBe(true)
    expect(processor.supports({ messageType: 'protocolMessage' } as any)).toBe(false)
    expect(processor.supports({ messageType: 'conversation', unwrapped: {} } as any)).toBe(false)
  })

  it('should process REVOKE protocol message', async () => {
    const context = {
      remoteJid: 'user@s.whatsapp.net',
      unwrapped: {
        protocolMessage: {
          type: 'REVOKE',
          key: { id: 'target-123' }
        }
      }
    } as unknown as IMessageProcessingContext

    const result = await processor.process(context, {} as IMessageServiceDependencyAccessor)

    expect(result).toEqual({
      type: 'protocol',
      subType: 'revoke',
      targetId: 'target-123',
      chatJid: 'user@s.whatsapp.net',
      key: { id: 'target-123' }
    })
  })

  it('should process MESSAGE_EDIT protocol message', async () => {
    const context = {
      remoteJid: 'user@s.whatsapp.net',
      unwrapped: {
        protocolMessage: {
          type: 'MESSAGE_EDIT',
          key: { id: 'target-123' },
          editedMessage: { conversation: 'edited text' }
        }
      }
    } as unknown as IMessageProcessingContext

    const result = await processor.process(context, {} as IMessageServiceDependencyAccessor)

    expect(result).toEqual({
      type: 'protocol',
      subType: 'edit',
      targetId: 'target-123',
      chatJid: 'user@s.whatsapp.net',
      key: { id: 'target-123' },
      editedTextContent: 'edited text',
      editedContent: { conversation: 'edited text' }
    })
  })
})
