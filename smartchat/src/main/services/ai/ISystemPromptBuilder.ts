import { AITool } from './IToolRegistry'

export interface UserDetails {
  phoneNumber: string
  lid: string
  phoneJid: string
  linkedJid: string
}

export interface ISystemPromptBuilder {
  build(
    tools: AITool[],
    protocolMode: 'react' | 'standard',
    userDetails?: UserDetails
  ): string
}
