import { describe, it, expect, vi } from 'vitest'
import { StandardMessageProcessor } from '../../../services/messages/processors/StandardMessageProcessor'
import { IMessageProcessingContext, IMessageServiceDependencyAccessor } from '../../../services/messages/processors/IMessageProcessorStrategy'

describe('StandardMessageProcessor', () => {
  const processor = new StandardMessageProcessor()

  it('should requireChat to be true', () => {
    expect(processor.requiresChat).toBe(true)
  })

  it('should support any message as a fallback', () => {
    expect(processor.supports({} as any)).toBe(true)
  })

  it('should process and save a standard message', async () => {
    const upsertMessageMock = vi.fn().mockResolvedValue({
      messageType: 'conversation',
      textContent: 'hello',
      content: '{}'
    })
    const indexMessageMock = vi.fn().mockResolvedValue(undefined)

    const dependencies = {
      repository: {
        upsertMessage: upsertMessageMock
      },
      embeddingService: {
        indexMessage: indexMessageMock
      }
    } as unknown as IMessageServiceDependencyAccessor

    const context = {
      messageType: 'conversation',
      remoteJid: 'user@s.whatsapp.net',
      senderId: 10,
      timestamp: 1600000000n,
      msg: {
        key: { id: 'msg-123', fromMe: false },
        status: 2
      },
      rawMessage: {},
      textContent: 'hello',
      participantString: 'user@s.whatsapp.net'
    } as unknown as IMessageProcessingContext

    const result = await processor.process(context, dependencies)

    expect(upsertMessageMock).toHaveBeenCalledWith({
      id: 'msg-123',
      chatJid: 'user@s.whatsapp.net',
      fromMe: false,
      senderId: 10,
      participant: 'user@s.whatsapp.net',
      timestamp: 1600000000n,
      messageType: 'conversation',
      content: '{}',
      textContent: 'hello',
      status: 'SENT',
      isDeleted: false
    })

    expect(indexMessageMock).toHaveBeenCalledWith('msg-123', 'hello')
    
    expect(result).toMatchObject({
      id: 'msg-123',
      chatJid: 'user@s.whatsapp.net',
      fromMe: false,
      messageType: 'conversation',
      textContent: 'hello',
      isDeleted: false,
      isEdited: false,
      status: 'SENT'
    })
  })

  it('should mark status as READ for self chat (note to self)', async () => {
    const upsertMessageMock = vi.fn().mockResolvedValue({
      messageType: 'conversation'
    })
    const dependencies = {
      repository: {
        upsertMessage: upsertMessageMock
      },
      embeddingService: {
        indexMessage: vi.fn().mockResolvedValue(undefined)
      }
    } as unknown as IMessageServiceDependencyAccessor

    const context = {
      messageType: 'conversation',
      remoteJid: 'my-id@s.whatsapp.net',
      senderId: 10,
      timestamp: 1600000000n,
      msg: {
        key: { id: 'msg-123', fromMe: false },
        status: 2
      },
      sock: {
        user: { id: 'my-id:12@s.whatsapp.net' } // cleanJid will strip :12
      }
    } as unknown as IMessageProcessingContext

    await processor.process(context, dependencies)

    expect(upsertMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'READ'
      })
    )
  })
})
