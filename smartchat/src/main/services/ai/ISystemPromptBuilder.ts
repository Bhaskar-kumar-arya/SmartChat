export interface UserDetails {
  phoneNumber: string
  lid: string
  phoneJid: string
  linkedJid: string
}

export interface ISystemPromptBuilder {
  build(
    tools: any[],
    protocolMode: 'react' | 'standard',
    userDetails?: UserDetails
  ): string
}
