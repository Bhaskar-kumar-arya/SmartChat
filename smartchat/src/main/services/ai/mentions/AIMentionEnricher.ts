import { IAIMentionEnricher } from './IAIMentionEnricher'
import { AIMention } from '../IAIService'
import { IChatEnrichmentStrategy } from './IChatEnrichmentStrategy'
import { IChatRepository } from '../../chats/IChatRepository'
import { Chat } from '../../../domain/entities'
import { IContactNameResolver, IContactQueryService } from '../../contacts/IContactService'

export class AIMentionEnricher implements IAIMentionEnricher {
  constructor(
    private readonly chatRepository: IChatRepository,
    private readonly contactService: IContactNameResolver & IContactQueryService,
    private readonly strategies: IChatEnrichmentStrategy[]
  ) {}

  async enrichMentionsInline(prompt: string, mentions: AIMention[]): Promise<string> {
    if (!mentions || mentions.length === 0) return prompt

    const jids = mentions.map(m => m.jid)
    const chats = await this.chatRepository.findChatsByJids(jids)
    const chatMap = new Map<string, Chat>(chats.map(c => [c.jid, c]))
    const nameMap = await this.contactService.batchResolveNames(jids, null)

    let enrichedPrompt = prompt
    for (const m of mentions) {
      const trimmedName = (m.name || '').trim()
      const safeName = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const mentionRegex = new RegExp(`@${safeName}`, 'g')
      
      const chat = chatMap.get(m.jid)
      let replacementStr = m.jid // Fallback to raw jid

      const resolvedLid = await this.contactService.resolveLidFromJid(m.jid)
      const lid = resolvedLid.includes('@lid') ? resolvedLid : null
      
      if (chat) {
        const chatType = chat.type || 'UNKNOWN'
        const strategy = this.strategies.find(s => s.canHandle(chatType))
        
        const displayName = chat.name || nameMap.get(m.jid) || m.jid.split('@')[0]

        if (strategy) {
          replacementStr = await strategy.enrich({ jid: chat.jid, type: chatType }, displayName, lid)
        }
      } else {
        // Chat not found in DB, fallback to basic info with default strategy
        const displayName = nameMap.get(m.jid) || m.name || m.jid.split('@')[0]
        const strategy = this.strategies.find(s => s.canHandle('Unknown'))
        if (strategy) {
          replacementStr = await strategy.enrich({ jid: m.jid, type: 'Unknown' }, displayName, lid)
        }
      }

      enrichedPrompt = enrichedPrompt.replace(mentionRegex, replacementStr)
    }

    return enrichedPrompt
  }
}
