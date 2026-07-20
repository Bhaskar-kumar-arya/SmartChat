import { IWAEventBus } from '../../services/whatsapp/IWAEventBus'
import { ExtensionEventName, ExtensionEventMap } from '../context/ExtensionEventMap'
import { IExtensionEventBridge } from './IExtensionEventBridge'

export class ExtensionEventBridge implements IExtensionEventBridge {
  private subscribers = new Map<string, Array<{ event: ExtensionEventName; handler: (payload: unknown) => void | Promise<void> }>>()
  private busAttached = false

  constructor(private readonly getBus: () => IWAEventBus | null) {}

  public attach(): void {
    this.setupListeners()
  }

  private setupListeners() {
    const bus = this.getBus()
    if (!bus || this.busAttached) return
    this.busAttached = true
    
    bus.on('message:incoming', (raw) => {
      const safe = {
        chatJid: raw.chatJid,
        senderJid: raw.senderJid,
        textContent: raw.textContent,
        fromMe: raw.fromMe,
        timestamp: raw.timestamp,
        enriched: raw.enriched
      }
      this.emit('message:incoming', safe)
    })

    bus.on('message:deleted', (raw) => {
      this.emit('message:deleted', {
        messageId: raw.messageId,
        chatJid: raw.chatJid,
        fromMe: raw.fromMe
      })
    })

    bus.on('message:edited', (raw) => {
      this.emit('message:edited', {
        messageId: raw.messageId,
        chatJid: raw.chatJid,
        fromMe: raw.fromMe,
        participant: raw.participant,
        editedTextContent: raw.editedTextContent
      })
    })

    bus.on('message:status-updated', (raw) => {
      this.emit('message:status-updated', {
        id: raw.id,
        chatJid: raw.chatJid,
        status: raw.status
      })
    })

    bus.on('reaction:processed', (raw) => {
      this.emit('reaction:processed', raw)
    })

    bus.on('chat:upserted', (raw) => {
      this.emit('chat:created', {
        jid: raw.jid,
        name: raw.raw.name || undefined
      })
    })

    bus.on('chat:updated', (raw) => {
      if (raw.update.archived !== undefined) {
        this.emit('chat:archived', {
          jid: raw.jid,
          archived: !!raw.update.archived
        })
      }
      if (raw.update.pinned !== undefined) {
        this.emit('chat:pinned', {
          jid: raw.jid,
          pinned: !!raw.update.pinned
        })
      }
    })

    bus.on('contact:upserted', (raw) => {
      for (const contact of raw.contacts) {
        if (!contact.id) continue;
        this.emit('contact:updated', {
          jid: contact.id,
          name: contact.name ?? undefined,
          pushName: contact.notify ?? undefined
        })
      }
    })

    bus.on('contact:updated', (raw) => {
      for (const contact of raw.contacts) {
        if (!contact.id) continue;
        this.emit('contact:updated', {
          jid: contact.id,
          name: contact.name ?? undefined,
          pushName: contact.notify ?? undefined
        })
      }
    })

    bus.on('group:participants', (raw) => {
      if (raw.action === 'add') {
        this.emit('group:participant-added', {
          id: raw.id,
          participants: raw.participants
        })
      } else if (raw.action === 'remove') {
        this.emit('group:participant-removed', {
          id: raw.id,
          participants: raw.participants
        })
      }
    })

    bus.on('group:updated', (raw) => {
      for (const update of raw.updates) {
        if (update.id && update.subject) {
          this.emit('group:subject-changed', {
            id: update.id,
            subject: update.subject
          })
        }
      }
    })
    
    // We cast to any because we know these events are emitted by the bridge
    // but they might not be perfectly typed in WAEventMap.
    bus.on('wa-connected' as any, () => {
      this.emit('connection:open', {})
    })

    bus.on('wa-logged-out' as any, () => {
      this.emit('connection:close', {})
    })
  }

  public subscribeExtension(
    extensionId: string,
    event: ExtensionEventName,
    handler: (payload: unknown) => void | Promise<void>
  ): () => void {
    this.setupListeners()
    if (!this.subscribers.has(extensionId)) {
      this.subscribers.set(extensionId, [])
    }
    const list = this.subscribers.get(extensionId)!
    list.push({ event, handler })
    return () => {
      const idx = list.findIndex(h => h.handler === handler && h.event === event)
      if (idx !== -1) {
        list.splice(idx, 1)
      }
    }
  }

  public unsubscribeAll(extensionId: string): void {
    this.subscribers.delete(extensionId)
  }

  private emit<K extends ExtensionEventName>(event: K, payload: ExtensionEventMap[K]) {
    for (const [_, list] of this.subscribers) {
      for (const sub of list) {
        if (sub.event === event) {
          Promise.resolve(sub.handler(payload)).catch(console.error)
        }
      }
    }
  }

  public emitToExtension<K extends ExtensionEventName>(extensionId: string, event: K, payload: ExtensionEventMap[K]): void {
    const list = this.subscribers.get(extensionId)
    if (list) {
      for (const sub of list) {
        if (sub.event === event) {
          Promise.resolve(sub.handler(payload)).catch(console.error)
        }
      }
    }
  }
}
