import { IChatEnrichmentStrategy, IChatMentionData } from '../IChatEnrichmentStrategy'
import { IChatReadRepository } from '../../../chats/IChatRepository'

export class CommunityEnrichmentStrategy implements IChatEnrichmentStrategy {
  constructor(private readonly chatRepository: IChatReadRepository) {}

  canHandle(chatType: string): boolean {
    return chatType === 'COMMUNITY'
  }

  async enrich(chat: IChatMentionData, name: string, lid: string | null): Promise<string> {
    const lidAttr = lid ? ` lid="${lid}"` : ''
    let xml = `<mentioned_chat jid="${chat.jid}" type="Community"${lidAttr}>\n`
    xml += `  <name>${name}</name>\n`
    
    // Fetch subgroups directly
    const allSubgroups = await this.chatRepository.findChatsByCommunityJids([chat.jid])
    const subgroups = allSubgroups.filter(s => s.community?.jid === chat.jid && s.jid !== chat.jid)

    if (subgroups.length > 0) {
      xml += `  <subgroups>\n`
      for (const sg of subgroups) {
        const sgName = sg.name || sg.jid.split('@')[0]
        xml += `    <subgroup jid="${sg.jid}">${sgName}</subgroup>\n`
      }
      xml += `  </subgroups>\n`
    }
    
    xml += `</mentioned_chat>`
    return xml
  }
}
