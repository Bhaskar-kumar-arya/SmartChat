import { IChatEnrichmentStrategy, IChatMentionData } from '../IChatEnrichmentStrategy'

export class GroupEnrichmentStrategy implements IChatEnrichmentStrategy {
  canHandle(chatType: string): boolean {
    return chatType === 'GROUP' || chatType === 'NEWSLETTER'
  }

  async enrich(chat: IChatMentionData, name: string, lid: string | null): Promise<string> {
    const lidAttr = lid ? ` lid="${lid}"` : ''
    const typeLabel = chat.type === 'NEWSLETTER' ? 'Channel' : 'Group Chat'
    return `<mentioned_chat jid="${chat.jid}" type="${typeLabel}"${lidAttr}><name>${name}</name></mentioned_chat>`
  }
}
