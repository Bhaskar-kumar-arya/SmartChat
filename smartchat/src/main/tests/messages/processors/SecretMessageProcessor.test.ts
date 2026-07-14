import { describe, it, expect, vi } from 'vitest'
import { SecretMessageProcessor } from '../../../services/messages/processors/SecretMessageProcessor'
import { IMessageProcessingContext, IMessageServiceDependencyAccessor } from '../../../services/messages/processors/IMessageProcessorStrategy'

describe('SecretMessageProcessor', () => {
  const processor = new SecretMessageProcessor()

  it('should requireChat to be false', () => {
    expect(processor.requiresChat).toBe(false)
  })

  it('should support secretEncryptedMessage and encReactionMessage', () => {
    expect(processor.supports({ msg: { message: { secretEncryptedMessage: {} } } } as any)).toBe(true)
    expect(processor.supports({ msg: { message: { encReactionMessage: {} } } } as any)).toBe(true)
    expect(processor.supports({ msg: { message: { conversation: 'hello' } } } as any)).toBe(false)
    expect(processor.supports({ msg: {} } as any)).toBe(false)
  })

  it('should call handleSecretMessage on dependencies', async () => {
    const handleSecretMessageMock = vi.fn().mockResolvedValue({ some: 'result' })
    const dependencies = {
      secretMessageService: {
        handleSecretMessage: handleSecretMessageMock
      }
    } as unknown as IMessageServiceDependencyAccessor

    const context = {
      msg: { message: { secretEncryptedMessage: {} } },
      sock: { id: 'sock-1' }
    } as unknown as IMessageProcessingContext

    const result = await processor.process(context, dependencies)

    expect(handleSecretMessageMock).toHaveBeenCalledWith(context.msg, context.sock)
    expect(result).toEqual({ some: 'result' })
  })
})
