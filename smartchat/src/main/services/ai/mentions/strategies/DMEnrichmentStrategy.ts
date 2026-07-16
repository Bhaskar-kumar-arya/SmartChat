import { IChatEnrichmentStrategy, IChatMentionData } from '../IChatEnrichmentStrategy'
import { IContactQueryService } from '../../../contacts/IContactService'

export class DMEnrichmentStrategy implements IChatEnrichmentStrategy {
  constructor(private readonly contactService: IContactQueryService) {}
  canHandle(chatType: string): boolean {
    return chatType === 'DM'
  }

  async enrich(chat: IChatMentionData, name: string, lid: string | null): Promise<string> {
    const lidAttr = lid ? ` lid="${lid}"` : ''
    const identId = await this.contactService.getIdentityIdByJid(chat.jid)
    const identityAttr = identId ? ` identityId="${identId}"` : ''
    return `<mentioned_chat jid="${chat.jid}" type="Direct Message"${lidAttr}${identityAttr}><name>${name}</name></mentioned_chat>`
  }
}
