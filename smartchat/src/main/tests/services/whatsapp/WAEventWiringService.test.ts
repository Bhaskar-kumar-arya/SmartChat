import { describe, it, expect, vi, beforeEach, Mocked } from 'vitest'
import { WAEventWiringService } from '../../../services/whatsapp/WAEventWiringService'
import { IHistorySyncManager } from '../../../services/whatsapp/IHistorySyncManager'
import { WAEventHandler } from '../../../services/whatsapp/WAEventHandler'

describe('WAEventWiringService', () => {
  let mockHistorySyncManager: Mocked<IHistorySyncManager>
  let service: WAEventWiringService

  beforeEach(() => {
    mockHistorySyncManager = {
      handleSyncChunk: vi.fn()
    } as any

    service = new WAEventWiringService(mockHistorySyncManager)
  })

  it('should wire events to handlers', async () => {
    const processMock = vi.fn().mockImplementation(async (cb) => {
      // Simulate emitting events via process callback
      await cb({
        'connection.update': { connection: 'open' },
        'messaging-history.set': { data: 'sync_data' },
        'messages.upsert': { messages: [] },
        'presence.update': { id: '123' }
      })
    })

    const onMock = vi.fn()
    
    const mockSock = {
      ev: {
        process: processMock,
        on: onMock,
        setMaxListeners: vi.fn()
      }
    } as any

    const mockEventHandler = {
      handleMessagesUpsert: vi.fn(),
      handlePresenceUpdate: vi.fn()
    } as unknown as WAEventHandler

    const mockCallbacks = {
      handleConnectionOpen: vi.fn(),
      handleConnectionClose: vi.fn(),
      handleConnectionUpdate: vi.fn(),
      handleQr: vi.fn()
    }

    const mockSaveCreds = vi.fn()

    service.wire(mockSock, mockEventHandler, mockCallbacks, mockSaveCreds, true)
    
    // Wait for the async callback inside processMock to complete
    await new Promise(process.nextTick)

    expect(onMock).toHaveBeenCalledWith('creds.update', mockSaveCreds)
    
    expect(mockCallbacks.handleConnectionOpen).toHaveBeenCalledWith(mockSock, true)
    expect(mockCallbacks.handleConnectionUpdate).toHaveBeenCalledWith({ connection: 'open' })
    expect(mockHistorySyncManager.handleSyncChunk).toHaveBeenCalledWith({ data: 'sync_data' }, true, mockSock)
    expect(mockEventHandler.handleMessagesUpsert).toHaveBeenCalledWith({ messages: [] }, mockSock)
    expect(mockEventHandler.handlePresenceUpdate).toHaveBeenCalledWith({ id: '123' }, mockSock)
  })
})
