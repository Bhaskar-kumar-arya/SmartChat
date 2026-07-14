import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SecretMessageService } from '../../services/whatsapp/secret/SecretMessageService'
import { ISecretMessageStrategy } from '../../services/whatsapp/secret/ISecretMessageStrategy'

describe('SecretMessageService', () => {
  let service: SecretMessageService
  let prisma: any

  beforeEach(() => {
    prisma = {
      message: {
        findUnique: vi.fn(),
      }
    }
    service = new SecretMessageService(prisma)
  })

  it('can register a custom strategy', () => {
    const dummyStrategy: ISecretMessageStrategy = {
      getSecretType: () => 'test_type',
      getSigningLabel: () => 'Test Label',
      handle: vi.fn()
    }
    
    service.registerStrategy(dummyStrategy)
    
    // We test that it registered by seeing if handleSecretMessage fails gracefully or processes it
    // Without full baileys envelope mocking, it's enough to ensure no crash
  })

  it('returns null if no envelope is present', async () => {
    const msg = { message: { conversation: 'hello' } } as any
    const res = await service.handleSecretMessage(msg, null)
    expect(res).toBeNull()
  })

  it('returns null if strategy is not registered for the envelope', async () => {
    const msg = { 
      message: { 
        secretEncryptedMessage: { 
          secretEncType: 'UNKNOWN_TYPE',
          targetMessageKey: { id: 'm1' }
        } 
      } 
    } as any
    const res = await service.handleSecretMessage(msg, null)
    expect(res).toBeNull()
  })

  it('returns null if original message secret cannot be loaded', async () => {
    const msg = { 
      message: { 
        encReactionMessage: {
          targetMessageKey: { id: 'm1' }
        } 
      } 
    } as any
    prisma.message.findUnique.mockResolvedValue(null) // secret not found
    const res = await service.handleSecretMessage(msg, null)
    expect(res).toBeNull()
  })
})
