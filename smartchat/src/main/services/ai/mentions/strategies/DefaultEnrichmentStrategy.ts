import { IChatEnrichmentStrategy, IChatMentionData } from '../IChatEnrichmentStrategy'
import { escapeXml } from '../xmlEscape'

export class DefaultEnrichmentStrategy implements IChatEnrichmentStrategy {
  canHandle(_chatType: string): boolean {
    return true
  }

  async enrich(chat: IChatMentionData, name: string, lid: string | null): Promise<string> {
    const lidAttr = lid ? ` lid="${escapeXml(lid)}"` : ''
    const chatType = chat.type || 'Unknown'
    return `<mentioned_chat jid="${escapeXml(chat.jid)}" type="${escapeXml(chatType)}"${lidAttr}><name>${escapeXml(name)}</name></mentioned_chat>`
  }
}
