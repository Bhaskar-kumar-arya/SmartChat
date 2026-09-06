import { IChatEnrichmentStrategy, IChatMentionData } from '../IChatEnrichmentStrategy'
import { escapeXml } from '../xmlEscape'

export class GroupEnrichmentStrategy implements IChatEnrichmentStrategy {
  canHandle(chatType: string): boolean {
    return chatType === 'GROUP' || chatType === 'NEWSLETTER'
  }

  async enrich(chat: IChatMentionData, name: string, lid: string | null): Promise<string> {
    const lidAttr = lid ? ` lid="${escapeXml(lid)}"` : ''
    const typeLabel = chat.type === 'NEWSLETTER' ? 'Channel' : 'Group Chat'
    return `<mentioned_chat jid="${escapeXml(chat.jid)}" type="${typeLabel}"${lidAttr}><name>${escapeXml(name)}</name></mentioned_chat>`
  }
}
