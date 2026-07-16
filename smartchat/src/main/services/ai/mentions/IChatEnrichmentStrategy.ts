export interface IChatMentionData {
  jid: string
  type: string
}

export interface IChatEnrichmentStrategy {
  canHandle(chatType: string): boolean
  enrich(chat: IChatMentionData, name: string, lid: string | null): Promise<string>
}
