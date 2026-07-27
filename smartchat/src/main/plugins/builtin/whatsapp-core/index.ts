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
    const chats = ctx.chats

    ctx.contributions.registerChatAction?.('pin', async (actionCtx) => {
      const jid = actionCtx?.chatJid
      ctx.log.info(`Executing chat action 'pin' for ${jid}`)
      if (jid && chats) {
        await chats.pin(jid)
      }
    })

    ctx.contributions.registerChatAction?.('unpin', async (actionCtx) => {
      const jid = actionCtx?.chatJid
      ctx.log.info(`Executing chat action 'unpin' for ${jid}`)
      if (jid && chats) {
        await chats.unpin(jid)
      }
    })

    ctx.contributions.registerChatAction?.('archive', async (actionCtx) => {
      const jid = actionCtx?.chatJid
      ctx.log.info(`Executing chat action 'archive' for ${jid}`)
      if (jid && chats) {
        await chats.archive(jid)
      }
    })

    ctx.contributions.registerChatAction?.('unarchive', async (actionCtx) => {
      const jid = actionCtx?.chatJid
      ctx.log.info(`Executing chat action 'unarchive' for ${jid}`)
      if (jid && chats) {
        await chats.unarchive(jid)
      }
    })

    ctx.contributions.registerChatAction?.('mute', async (actionCtx) => {
      const jid = actionCtx?.chatJid
      const durationMs = (actionCtx as { durationMs?: number })?.durationMs ?? -1
      ctx.log.info(`Executing chat action 'mute' for ${jid}`)
      if (jid && chats) {
        await chats.mute(jid, durationMs)
      }
    })

    ctx.contributions.registerChatAction?.('unmute', async (actionCtx) => {
      const jid = actionCtx?.chatJid
      ctx.log.info(`Executing chat action 'unmute' for ${jid}`)
      if (jid && chats) {
        await chats.unmute(jid)
      }
    })

    ctx.contributions.registerChatAction?.('mark-read', async (actionCtx) => {
      const jid = actionCtx?.chatJid
      ctx.log.info(`Executing chat action 'mark-read' for ${jid}`)
      if (jid && chats) {
        await chats.markRead(jid)
      }
    })
  }

  async deactivate(): Promise<void> {
    // Cleanup handled by host
  }
}
