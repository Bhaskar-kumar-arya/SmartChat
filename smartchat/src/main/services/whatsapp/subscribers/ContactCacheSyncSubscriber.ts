import type { IWAEventBus } from '../IWAEventBus'
import type { IWAEventSubscriber } from './IWAEventSubscriber'
import type { IContactService } from '../../contacts/IContactService'

/**
 * ContactCacheSyncSubscriber
 * ==========================
 * The identity de-duplication pass (`deduplicateIdentities`) runs in the
 * WhatsApp worker at the end of a history sync and deletes stub `Identity`
 * rows. The worker clears *its own* `ContactCache` afterwards, but the main
 * process keeps a separate `ContactService`/`ContactCache` instance whose
 * `identityIdCache` (`jid -> id`, never TTL'd) is populated continuously from
 * forwarded events. Nothing tells the main process those ids are now stale.
 *
 * This subscriber flushes the main-process contact caches whenever a sync
 * completes, so a later `updateIdentity(stubId, …)` / `findIdentityById(stubId)`
 * in the main process doesn't hit a deleted row (Prisma P2025 / name falling
 * back to the bare phone number until restart).
 */
export class ContactCacheSyncSubscriber implements IWAEventSubscriber {
  constructor(private readonly contactService: IContactService) {}

  register(bus: IWAEventBus): void {
    bus.on('wa-sync-complete', this.onSyncComplete.bind(this))
  }

  dispose(): void {
    // Bus cleanup handles listener removal
  }

  private onSyncComplete(): void {
    console.log('[ContactCacheSyncSubscriber] Sync complete — flushing main-process contact caches (post-dedup).')
    this.contactService.clearCaches()
  }
}
