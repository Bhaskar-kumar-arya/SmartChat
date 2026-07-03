import type { IWAEventBus } from '../IWAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'
import type { CallEvent } from '../WAEventTypes'
import type { ICallMutationService } from '../../calls/ICallService'
import type { IContactMutationService } from '../../contacts/IContactService'
import { cleanJid } from '../../../utils/jidUtils'

export class CallEventSubscriber implements IWAEventSubscriber {
  constructor(
    private callService: ICallMutationService,
    private contactService: IContactMutationService
  ) {}

  register(bus: IWAEventBus): void {
    bus.on('call:event', this.onCall.bind(this))
  }

  dispose(): void {}

  private async onCall(event: CallEvent): Promise<void> {
    for (const call of event.calls) {
      try {
        console.log(`[CallEventSubscriber] Processing call: id=${call.id}, from=${call.from}, status=${call.status}, isVideo=${call.isVideo}`)
        // Save the call log to the database so we can enrich historical messages
        await this.callService.upsertCallLog({
          id: call.id,
          callerJid: cleanJid(call.from),
          isVideo: call.isVideo ?? false,
          isGroup: call.isGroup ?? false,
          status: call.status,
          timestamp: BigInt(Math.floor(Date.now() / 1000)) // Fallback, Baileys Call doesn't have timestamp usually
        })

        // Also do LID to PN mapping
        const fromJid = call.from
        const altPn = call.callerPn || call.content?.attrs?.['caller_pn'] || call.attrs?.['caller_pn']
        const altLid = call.content?.attrs?.['caller_lid'] || call.attrs?.['caller_lid']

        const ids = [fromJid, altPn, altLid].filter(Boolean) as string[]
        let callLid: string | null = null
        let callPn: string | null = null

        for (const id of ids) {
          if (typeof id === 'string') {
            const clean = cleanJid(id)
            if (clean.includes('@lid')) callLid = clean
            if (clean.includes('@s.whatsapp.net')) callPn = clean
          }
        }

        if (callLid && callPn) {
          await this.contactService
            .linkLidAndPn(callLid, callPn, 'call.event')
            .catch((err) => {
               console.error('[CallEventSubscriber] Failed to link LID and PN in call event:', err)
            })
        }
      } catch (err) {
        console.error('[CallEventSubscriber] Error processing call event:', err)
      }
    }
  }
}
