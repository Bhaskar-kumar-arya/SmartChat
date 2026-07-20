import { ICapabilityProvider } from '../ICapabilityProvider'
import { IExtensionEventAPI } from '../../context/ExtensionContext'
import { ExtensionManifest } from '../../types/ExtensionManifest'
import { IExtensionEventBridge } from '../../events/IExtensionEventBridge'
import { IDocSource, DocSection } from '../../docs/IDocSource'
import { GENERATED_EVENTS, GENERATED_INTERFACES } from '../../docs/generatedDocs'

export class EventCapabilityProvider implements ICapabilityProvider<IExtensionEventAPI>, IDocSource {
  public getDocSection(): DocSection {
    let body = `Subscribe to real-time WhatsApp events.
Requires at least one "events:*" permission in your manifest.

Method:
  ctx.events.on<K extends EventName>(event: K, handler: (payload: EventMap[K]) => void | Promise<void>): () => void
  Returns an unsubscribe function — call it in onDeactivate to avoid memory leaks.

──────────────────────────────────────────
AVAILABLE EVENTS & PAYLOAD TYPES (AUTO-GENERATED)
──────────────────────────────────────────\n`

    for (const ev of GENERATED_EVENTS) {
      body += `\n'${ev.name}' — maps to ${ev.payloadInterface}\n`
      body += `${ev.payloadDef.split('\n').map(line => '  ' + line).join('\n')}\n`
    }

    body += `\n──────────────────────────────────────────
REFERENCED DATA STRUCTURES
──────────────────────────────────────────\n`
    if (GENERATED_INTERFACES['EnrichedMessage']) {
      body += `\n${GENERATED_INTERFACES['EnrichedMessage'].split('\n').map(line => '  ' + line).join('\n')}\n`
    }

    body += `\n──────────────────────────────────────────
EXAMPLE
──────────────────────────────────────────
  module.exports = async (ctx) => {
    if (!ctx.events) return

    const unsub = ctx.events.on('message:incoming', async (payload) => {
      if (payload.fromMe) return
      ctx.log.info('New message from', payload.senderJid, payload.textContent)
    })

    ctx.onDeactivate(async () => unsub())
  }`

    return {
      heading: 'ctx.events',
      permissions: ['events:message:incoming (or any events:* variant)'],
      body
    }
  }

  // It provides event capabilities. We check if they have any 'events:*' permission.
  public readonly permissions: string[] = [] // Not checked directly, we'll implement custom build logic.

  constructor(private readonly eventBridge: IExtensionEventBridge) {}

  public build(manifest: ExtensionManifest): IExtensionEventAPI | undefined {
    const hasAnyEventPerm = manifest.permissions.some(p => p.startsWith('events:'))
    
    // For now, if they request any events: permission, we provide the full API.
    // Finer-grained control can be implemented by validating the requested event 
    // against the permissions list at runtime.
    if (!hasAnyEventPerm) {
      return undefined
    }

    return {
      on: (event, handler) => {
        // Enforce specific event permissions if needed:
        // if (!manifest.permissions.includes(`events:${event}`)) {
        //   throw new PermissionError(...)
        // }
        return this.eventBridge.subscribeExtension(manifest.id, event, handler as (payload: unknown) => void | Promise<void>)
      }
    }
  }
}
