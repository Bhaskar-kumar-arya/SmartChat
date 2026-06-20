export interface UserDetails {
  phoneNumber: string
  lid: string
  phoneJid: string
  linkedJid: string
}

export interface ISystemPromptBuilder {
  build(
    tools: any[],
    useThinkMode: boolean,
    userDetails?: UserDetails
  ): string
}
