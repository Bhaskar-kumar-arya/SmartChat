import { ISystemPromptBuilder, UserDetails } from './ISystemPromptBuilder'
import { IProtocolStrategy } from './prompts/IProtocolStrategy'
import { formatTools } from './prompts/ToolDefinitionFormatter'
import { AITool } from './IToolRegistry'
import {
  ROLE_SECTION,
  WHATSAPP_CONTEXT_SECTION,
  DISPOSITION_SECTION,
  MESSAGE_ROLES_SECTION
} from './prompts/SystemPromptContent'

export type { UserDetails }

export class SystemPromptBuilder implements ISystemPromptBuilder {
  constructor(
    private readonly reactStrategy: IProtocolStrategy,
    private readonly standardStrategy: IProtocolStrategy
  ) {}

  build(
    tools: AITool[],
    protocolMode: 'react' | 'standard',
    userDetails?: UserDetails
  ): string {
    const formattedTools = formatTools(tools)

    const phoneNum = userDetails?.phoneNumber || ''
    const lid = userDetails?.lid || ''
    const phoneJid = userDetails?.phoneJid || ''
    const linkedJid = userDetails?.linkedJid || ''

    const identitySection = `
# USER's identity ("Me" / "myself")
- Phone Number: ${phoneNum}
- Linked ID (LID): ${lid}
- Phone JID: ${phoneJid}
- Linked JID: ${linkedJid}
`.trim()

    const strategy = protocolMode === 'react' ? this.reactStrategy : this.standardStrategy
    const protocolBlock = strategy.getProtocolBlock()

    return `
${ROLE_SECTION}

The current date and time is: ${new Date().toLocaleString()}.

${WHATSAPP_CONTEXT_SECTION}

${DISPOSITION_SECTION}

${MESSAGE_ROLES_SECTION}

${identitySection}

# YOUR TOOLS
You have access to a set of registered tools. Each tool's description tells you exactly when, how, and why to use it. Only use tools that are listed.

${formattedTools}

${protocolBlock}
`.trim()
  }
}
