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

    const chats = (ctx as any).chats

    register('pin', async (actionCtx: any) => {
      const jid = actionCtx?.context?.jid || actionCtx?.context?.chatJid
      ctx.log?.info(`Executing chat action 'pin' for ${jid}`)
      if (jid && chats?.pin) {
        await chats.pin(jid)
      }
    })

    register('unpin', async (actionCtx: any) => {
      const jid = actionCtx?.context?.jid || actionCtx?.context?.chatJid
      ctx.log?.info(`Executing chat action 'unpin' for ${jid}`)
      if (jid && chats?.unpin) {
        await chats.unpin(jid)
      }
    })

    register('archive', async (actionCtx: any) => {
      const jid = actionCtx?.context?.jid || actionCtx?.context?.chatJid
      ctx.log?.info(`Executing chat action 'archive' for ${jid}`)
      if (jid && chats?.archive) {
        await chats.archive(jid)
      }
    })

    register('unarchive', async (actionCtx: any) => {
      const jid = actionCtx?.context?.jid || actionCtx?.context?.chatJid
      ctx.log?.info(`Executing chat action 'unarchive' for ${jid}`)
      if (jid && chats?.unarchive) {
        await chats.unarchive(jid)
      }
    })

    register('mute', async (actionCtx: any) => {
      const jid = actionCtx?.context?.jid || actionCtx?.context?.chatJid
      const durationMs = actionCtx?.context?.durationMs ?? -1
      ctx.log?.info(`Executing chat action 'mute' for ${jid}`)
      if (jid && chats?.mute) {
        await chats.mute(jid, durationMs)
      }
    })

    register('unmute', async (actionCtx: any) => {
      const jid = actionCtx?.context?.jid || actionCtx?.context?.chatJid
      ctx.log?.info(`Executing chat action 'unmute' for ${jid}`)
      if (jid && chats?.unmute) {
        await chats.unmute(jid)
      }
    })

    register('mark-read', async (actionCtx: any) => {
      const jid = actionCtx?.context?.jid || actionCtx?.context?.chatJid
      ctx.log?.info(`Executing chat action 'mark-read' for ${jid}`)
      if (jid && chats?.markRead) {
        await chats.markRead(jid)
      }
    })
  }

  async deactivate(): Promise<void> {
    // Cleanup handled by host
  }
}
