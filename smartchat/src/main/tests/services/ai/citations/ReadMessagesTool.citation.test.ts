import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReadMessagesTool } from '../../../../tools/ReadMessagesTool'
import { MessageFormatterRegistry } from '../../../../services/messages/formatters/MessageFormatterRegistry'

describe('ReadMessagesTool Citations', () => {
  let tool: ReadMessagesTool
  let mockMessageRepository: any
  let mockIdentityRepository: any
  let mockAliasRepository: any
  let mockChatRepository: any
  let mockFormatterRegistry: any
  let mockCitationEmitter: any

  beforeEach(() => {
    mockMessageRepository = {
      queryMessageIdsBySql: vi.fn(),
      findMessagesByIds: vi.fn(),
      findMessagesByChat: vi.fn()
    }
    mockIdentityRepository = {
      findMeIdentity: vi.fn().mockResolvedValue(null)
    }
    mockAliasRepository = {
      findIdentityAliases: vi.fn().mockResolvedValue([])
    }
    mockChatRepository = {
      findChatsByJids: vi.fn().mockResolvedValue([])
    }
    mockFormatterRegistry = {
      format: vi.fn().mockReturnValue('formatted message')
    }
    mockCitationEmitter = {
      register: vi.fn(),
      getEntries: vi.fn().mockReturnValue(new Map())
    }

    tool = new ReadMessagesTool(
      () => null,
      mockFormatterRegistry as unknown as MessageFormatterRegistry,
      mockMessageRepository,
      mockIdentityRepository,
      mockAliasRepository,
      mockChatRepository
    )
  })

  it('should not include citations if citationEmitter is not present in context', async () => {
    mockMessageRepository.findMessagesByChat.mockResolvedValue([
      { id: 'msg1', chatJid: 'chat@s.whatsapp.net', timestamp: BigInt(1000), textContent: 'hello' }
    ])

    const result = await tool.execute({ jid: 'chat@s.whatsapp.net' })

    expect(result.text).not.toContain('[1]')
    expect(result.text).toContain('formatted message')
    expect(result.citations).toBeUndefined()
  })

  it('should include citations and return map if citationEmitter is present in context', async () => {
    mockMessageRepository.findMessagesByChat.mockResolvedValue([
      { id: 'msg1', chatJid: 'chat@s.whatsapp.net', timestamp: BigInt(1000), textContent: 'hello' }
    ])

    mockCitationEmitter.register.mockReturnValue(1)

    const map = new Map()
    map.set(1, { type: 'message', chatJid: 'chat@s.whatsapp.net', messageId: 'msg1' })
    mockCitationEmitter.getEntries.mockReturnValue(map)

    const result = await tool.execute({ jid: 'chat@s.whatsapp.net' }, { citationEmitter: mockCitationEmitter })

    expect(mockCitationEmitter.register).toHaveBeenCalledWith({
      type: 'message',
      chatJid: 'chat@s.whatsapp.net',
      messageId: 'msg1'
    })
    expect(result.text).toContain('[1]')
    expect(result.text).toContain('formatted message')
    expect(result.citations).toBeDefined()
    const citation = result.citations?.get(1)
    expect(citation?.type).toBe('message')
    if (citation?.type === 'message') {
      expect(citation.messageId).toBe('msg1')
    }
  })
})
