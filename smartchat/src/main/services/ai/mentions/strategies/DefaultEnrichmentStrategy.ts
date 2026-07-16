import { IChatEnrichmentStrategy, IChatMentionData } from '../IChatEnrichmentStrategy'

export class DefaultEnrichmentStrategy implements IChatEnrichmentStrategy {
  canHandle(_chatType: string): boolean {
    return true
  }

  async enrich(chat: IChatMentionData, name: string, lid: string | null): Promise<string> {
    const lidAttr = lid ? ` lid="${lid}"` : ''
    const chatType = chat.type || 'Unknown'
    return `<mentioned_chat jid="${chat.jid}" type="${chatType}"${lidAttr}><name>${name}</name></mentioned_chat>`
  }
}
