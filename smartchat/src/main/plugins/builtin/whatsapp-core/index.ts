import { IBuiltinPlugin } from '../../../kernel/plugins/IBuiltinPlugin'
import { PluginManifest } from '../../../kernel/plugins/PluginManifest'
import { PluginContext } from '../../../kernel/plugins/PluginContext'

export class WhatsappCorePlugin implements IBuiltinPlugin {
  readonly id = 'com.smartchat.builtin.whatsapp-core'

  readonly manifest: PluginManifest = {
    id: 'com.smartchat.builtin.whatsapp-core',
    name: 'WhatsApp Core Plugin',
    version: '1.0.0',
    apiVersion: '2',
    main: 'index.ts',
    permissions: ['chats:read', 'chats:write'],
    contributions: {
      chatActions: [
        { id: 'pin', label: 'Pin Chat' },
        { id: 'unpin', label: 'Unpin Chat' },
        { id: 'archive', label: 'Archive Chat' },
        { id: 'unarchive', label: 'Unarchive Chat' },
        { id: 'mute', label: 'Mute Chat' },
        { id: 'unmute', label: 'Unmute Chat' },
        { id: 'mark-read', label: 'Mark as Read' }
      ]
    }
  }

  async activate(ctx: PluginContext): Promise<void> {
    const register = ctx.contributions?.registerChatAction
    if (!register) return

    const actions = ['pin', 'unpin', 'archive', 'unarchive', 'mute', 'unmute', 'mark-read']

    for (const actionId of actions) {
      register(actionId, async (actionCtx: unknown) => {
        ctx.log?.info(`Executing chat action: ${actionId}`, actionCtx)
      })
    }
  }

  async deactivate(): Promise<void> {
    // Cleanup handled by host
  }
}
