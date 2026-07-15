import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { ReceiptService, mapBaileysStatus } from '../../../services/whatsapp/ReceiptService'
import { IReceiptRepository } from '../../../services/messages/IReceiptRepository'
import { IContactNameResolver, IContactQueryService } from '../../../services/contacts/IContactService'
import { IWAEventBus } from '../../../services/whatsapp/IWAEventBus'

describe('mapBaileysStatus', () => {
  it('maps correctly', () => {
    expect(mapBaileysStatus(1)).toBe('PENDING')
    expect(mapBaileysStatus(2)).toBe('SENT')
    expect(mapBaileysStatus(3)).toBe('DELIVERED')
    expect(mapBaileysStatus(4)).toBe('READ')
    expect(mapBaileysStatus(5)).toBe('READ')
    expect(mapBaileysStatus(0)).toBe('SENT')
    expect(mapBaileysStatus(null)).toBe('SENT')
  })
})

describe('ReceiptService', () => {
  let mockReceiptRepo: Mocked<IReceiptRepository>
  let mockContactService: Mocked<IContactNameResolver & IContactQueryService>
  let mockBus: Mocked<IWAEventBus>
  let service: ReceiptService

  beforeEach(() => {
    mockReceiptRepo = {
      findMessageById: vi.fn(),
      updateMessageStatus: vi.fn(),
      upsertMessageReceipt: vi.fn().mockResolvedValue(undefined),
      getChatMembersCount: vi.fn(),
      getMessageReceiptsCount: vi.fn(),
      getMessageReceiptsWithStatusesCount: vi.fn(),
      getMessageReceipts: vi.fn()
    } as any

    mockContactService = {
      resolveName: vi.fn(),
      getMeJids: vi.fn().mockResolvedValue(['me@s.whatsapp.net'])
    } as any

    mockBus = {
      emit: vi.fn()
    } as any

    const getBus = vi.fn().mockReturnValue(mockBus)

    service = new ReceiptService(mockReceiptRepo, mockContactService, getBus)
    vi.clearAllMocks()
  })

  it('processMessageStatusUpdate should skip if msg not found', async () => {
    mockReceiptRepo.findMessageById.mockResolvedValue(null)
    await service.processMessageStatusUpdate({ id: 'msg1' }, 3)
    expect(mockReceiptRepo.updateMessageStatus).not.toHaveBeenCalled()
  })

  it('processMessageStatusUpdate should update if new status is higher', async () => {
    mockReceiptRepo.findMessageById.mockResolvedValue({ status: 'SENT', chatJid: 'chat1' } as any)
    await service.processMessageStatusUpdate({ id: 'msg1' }, 3) // 3 -> DELIVERED
    expect(mockReceiptRepo.updateMessageStatus).toHaveBeenCalledWith('msg1', 'DELIVERED')
    expect(mockBus.emit).toHaveBeenCalledWith('message:status-updated', { id: 'msg1', chatJid: 'chat1', status: 'DELIVERED' })
  })

  it('processMessageStatusUpdate should not update if new status is lower', async () => {
    mockReceiptRepo.findMessageById.mockResolvedValue({ status: 'READ', chatJid: 'chat1' } as any)
    await service.processMessageStatusUpdate({ id: 'msg1' }, 3) // 3 -> DELIVERED
    expect(mockReceiptRepo.updateMessageStatus).not.toHaveBeenCalled()
  })

  it('processMessageReceipt should skip if user is me and remote is not me', async () => {
    const update = { key: { id: 'msg1', remoteJid: 'other@s.whatsapp.net' }, receipt: { userJid: 'me@s.whatsapp.net' } }
    await service.processMessageReceipt(update, null)
    expect(mockReceiptRepo.findMessageById).not.toHaveBeenCalled()
  })

  it('processMessageReceipt for direct message', async () => {
    const update = { key: { id: 'msg1', remoteJid: 'other@s.whatsapp.net' }, receipt: { readTimestamp: 12345 } }
    mockReceiptRepo.findMessageById.mockResolvedValue({ status: 'SENT', chatJid: 'other@s.whatsapp.net' } as any)
    mockReceiptRepo.upsertMessageReceipt.mockResolvedValue(undefined)
    await service.processMessageReceipt(update, null)
    
    expect(mockReceiptRepo.upsertMessageReceipt).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 'msg1',
      status: 'READ'
    }))
    expect(mockReceiptRepo.updateMessageStatus).toHaveBeenCalledWith('msg1', 'READ')
    expect(mockBus.emit).toHaveBeenCalledWith('message:status-updated', expect.objectContaining({ status: 'READ' }))
  })
  
  it('processMessageReceipt for group message where everyone reads', async () => {
    const update = { key: { id: 'msg1', remoteJid: 'group@g.us' }, receipt: { readTimestamp: 12345, userJid: 'user2@s.whatsapp.net' } }
    mockReceiptRepo.findMessageById.mockResolvedValue({ status: 'SENT', chatJid: 'group@g.us' } as any)
    mockReceiptRepo.getChatMembersCount.mockResolvedValue(3)
    mockReceiptRepo.getMessageReceiptsCount.mockResolvedValue(2)

    await service.processMessageReceipt(update, null)

    expect(mockReceiptRepo.updateMessageStatus).toHaveBeenCalledWith('msg1', 'READ')
  })
})
