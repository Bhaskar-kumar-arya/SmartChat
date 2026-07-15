import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AIChatExportService } from '../../../services/ai/AIChatExportService'
import fs from 'fs'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn()
  }
}))

describe('AIChatExportService', () => {
  let service: AIChatExportService
  
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T10:00:00Z'))
    service = new AIChatExportService()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should export a new chat when no export file exists', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false)

    await service.exportChat(
      { id: 'session-1', title: 'Test Session', modelId: 'model-1' },
      [{ role: 'user', content: 'hello', timestamp: '2026-07-15T10:00:00.000Z' }]
    )

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('ai_chats_export.json'),
      expect.stringContaining('"sessionId": "session-1"'),
      'utf8'
    )
  })

  it('should update an existing exported chat', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const existingData = [{
      sessionId: 'session-1',
      title: 'Old Title',
      model: 'model-1',
      exportedAt: 'old-date',
      messages: []
    }]
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingData))

    await service.exportChat(
      { id: 'session-1', title: 'New Title', modelId: 'model-1' },
      [{ role: 'user', content: 'hello again' }]
    )

    // Should overwrite the existing session index
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('"title": "New Title"'),
      'utf8'
    )
    
    // Check that there is still only 1 session in the array
    const writeCallArgs = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string
    const writtenArray = JSON.parse(writeCallArgs)
    expect(writtenArray.length).toBe(1)
    expect(writtenArray[0].title).toBe('New Title')
  })

  it('should delete an exported chat', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const existingData = [
      { sessionId: 'session-1', title: 'T1', messages: [] },
      { sessionId: 'session-2', title: 'T2', messages: [] }
    ]
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingData))

    await service.deleteExportedChat('session-1')

    const writeCallArgs = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string
    const writtenArray = JSON.parse(writeCallArgs)
    expect(writtenArray.length).toBe(1)
    expect(writtenArray[0].sessionId).toBe('session-2')
  })

  it('should duplicate an exported chat', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true)
    const existingData = [
      { sessionId: 'session-1', title: 'T1', messages: [] }
    ]
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingData))

    await service.duplicateExportedChat('session-1')

    const writeCallArgs = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string
    const writtenArray = JSON.parse(writeCallArgs)
    expect(writtenArray.length).toBe(2)
    expect(writtenArray[1].sessionId).toContain('copy-')
    expect(writtenArray[1].title).toBe('T1 (Copy)')
  })
})
