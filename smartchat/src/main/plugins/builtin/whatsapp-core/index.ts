import { IBuiltinPlugin } from '../../../kernel/plugins/IBuiltinPlugin'
import { PluginManifest } from '../../../kernel/plugins/PluginManifest'
import { PluginContext } from '../../../kernel/plugins/PluginContext'
import { SVG_PIN, SVG_UNPIN, SVG_MUTE, SVG_UNMUTE, SVG_ARCHIVE, SVG_MARK_READ } from './svgIcons'

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
        { id: 'pin', label: 'Pin Chat', icon: SVG_PIN, when: { field: 'chat.isPinned', op: 'eq', value: false } },
        { id: 'unpin', label: 'Unpin Chat', icon: SVG_UNPIN, when: { field: 'chat.isPinned', op: 'eq', value: true } },
        { id: 'archive', label: 'Archive Chat', icon: SVG_ARCHIVE },
        { id: 'unarchive', label: 'Unarchive Chat', icon: SVG_ARCHIVE },
        {
          id: 'mute',
          label: 'Mute Chat',
          icon: SVG_MUTE,
          when: { field: 'chat.isMuted', op: 'eq', value: false },
          subMenu: [
            { id: '8h', label: '8 Hours', args: { relativeMs: 28800000 } },
            { id: '1w', label: '1 Week', args: { relativeMs: 604800000 } },
            { id: 'always', label: 'Always', args: { durationMs: -1 } }
          ]
        },
        { id: 'unmute', label: 'Unmute Chat', icon: SVG_UNMUTE, when: { field: 'chat.isMuted', op: 'eq', value: true } },
        { id: 'mark-read', label: 'Mark as Read', icon: SVG_MARK_READ }
      ]
    }
  }

  async activate(ctx: PluginContext): Promise<void> {
    const chats = ctx.chats

    const extractJid = (actionCtx: unknown): string | undefined => {
      if (!actionCtx || typeof actionCtx !== 'object') return undefined
      const obj = actionCtx as Record<string, unknown>
      const nested = obj.context as Record<string, unknown> | undefined
      return (
        (nested?.chatJid as string) ||
        (nested?.jid as string) ||
        (obj.chatJid as string) ||
        (obj.jid as string)
      )
    }

    ctx.contributions.registerChatAction?.('pin', async (actionCtx) => {
      const jid = extractJid(actionCtx)
      ctx.log.info(`Executing chat action 'pin' for ${jid}`)
      if (jid && chats) {
        await chats.pin(jid)
      }
    })

    ctx.contributions.registerChatAction?.('unpin', async (actionCtx) => {
      const jid = extractJid(actionCtx)
      ctx.log.info(`Executing chat action 'unpin' for ${jid}`)
      if (jid && chats) {
        await chats.unpin(jid)
      }
    })

    ctx.contributions.registerChatAction?.('archive', async (actionCtx) => {
      const jid = extractJid(actionCtx)
      ctx.log.info(`Executing chat action 'archive' for ${jid}`)
      if (jid && chats) {
        await chats.archive(jid)
      }
    })

    ctx.contributions.registerChatAction?.('unarchive', async (actionCtx) => {
      const jid = extractJid(actionCtx)
      ctx.log.info(`Executing chat action 'unarchive' for ${jid}`)
      if (jid && chats) {
        await chats.unarchive(jid)
      }
    })

    ctx.contributions.registerChatAction?.('mute', async (actionCtx) => {
      const jid = extractJid(actionCtx)
      const obj = actionCtx as unknown as Record<string, unknown> | undefined
      const nested = (obj?.context as Record<string, unknown> | undefined) || obj
      const relativeMs = nested?.relativeMs as number | undefined
      const rawDurationMs = nested?.durationMs as number | undefined
      const durationMs = relativeMs !== undefined ? Date.now() + relativeMs : (rawDurationMs ?? -1)
      ctx.log.info(`Executing chat action 'mute' for ${jid} with durationMs ${durationMs}`)
      if (jid && chats) {
        await chats.mute(jid, durationMs)
      }
    })

    ctx.contributions.registerChatAction?.('unmute', async (actionCtx) => {
      const jid = extractJid(actionCtx)
      ctx.log.info(`Executing chat action 'unmute' for ${jid}`)
      if (jid && chats) {
        await chats.unmute(jid)
      }
    })

    ctx.contributions.registerChatAction?.('mark-read', async (actionCtx) => {
      const jid = extractJid(actionCtx)
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
