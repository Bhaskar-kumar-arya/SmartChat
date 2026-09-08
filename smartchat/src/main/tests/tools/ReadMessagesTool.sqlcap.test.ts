import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReadMessagesTool } from '../../tools/ReadMessagesTool'
import { MessageFormatterRegistry } from '../../services/messages/formatters/MessageFormatterRegistry'

describe('ReadMessagesTool — custom-SQL row cap (P2-S12-01)', () => {
  let tool: ReadMessagesTool
  let repo: any

  beforeEach(() => {
    repo = {
      queryMessageIdsBySql: vi.fn(),
      findMessagesByIds: vi.fn(),
      findMessagesByChat: vi.fn()
    }
    tool = new ReadMessagesTool(
      () => null,
      { format: vi.fn().mockReturnValue('m') } as unknown as MessageFormatterRegistry,
      repo,
      { findMeIdentity: vi.fn().mockResolvedValue(null) } as any,
      { findIdentityAliases: vi.fn().mockResolvedValue([]) } as any,
      { findChatsByJids: vi.fn().mockResolvedValue([]) } as any
    )
  })

  it('caps the number of message ids fetched and formatted, and flags truncation', async () => {
    const ids = Array.from({ length: 5000 }, (_, i) => ({ id: `m${i}` }))
    repo.queryMessageIdsBySql.mockResolvedValue(ids)
    repo.findMessagesByIds.mockImplementation(async (requested: string[]) =>
      requested.map((id) => ({ id, chatJid: 'c@s.whatsapp.net', timestamp: BigInt(1), textContent: 't' }))
    )

    const res = await tool.execute({ sql: 'SELECT id FROM Message' })

    const fetched = repo.findMessagesByIds.mock.calls[0][0] as string[]
    expect(fetched).toHaveLength(3000)
    expect(res.text).toContain('result truncated to the first 3000 messages')
  })

  it('does not flag truncation when under the cap', async () => {
    repo.queryMessageIdsBySql.mockResolvedValue([{ id: 'm1' }])
    repo.findMessagesByIds.mockResolvedValue([
      { id: 'm1', chatJid: 'c@s.whatsapp.net', timestamp: BigInt(1), textContent: 't' }
    ])
    const res = await tool.execute({ sql: 'SELECT id FROM Message WHERE id = 1' })
    expect(res.text).not.toContain('truncated')
  })
})
