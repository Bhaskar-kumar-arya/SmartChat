import { IContactMutationService, IContactQueryService, ISocketUserContext } from '../contacts/IContactService'
import { IIdentityRepository } from '../contacts/IIdentityRepository'
import { IIdentityReconciliationService } from '../contacts/IIdentityReconciliationService'
import { cleanJid } from '../../utils/jidUtils'
import { WAMessageKey } from '../whatsapp/types'
import { IMessageIdentityResolver } from './IMessageIdentityResolver'

export class MessageIdentityResolver implements IMessageIdentityResolver {
  constructor(
    private readonly contactService: IContactMutationService & IContactQueryService,
    public readonly identityRepository: IIdentityRepository,
    private readonly identityReconciliationService: IIdentityReconciliationService
  ) {}

  /**
   * Resolves the JID of the sender of a message.
   */
  async resolveSenderJid(key: WAMessageKey, sock: ISocketUserContext | null): Promise<string | null> {
    const remoteJid = cleanJid(key.remoteJid ?? '')
    let participantString = key.participant
      ? cleanJid(key.participant)
      : remoteJid.endsWith('@g.us')
      ? null
      : remoteJid

    if (key.fromMe) {
      if (sock?.user) {
        const myJid = sock.user.id ?? ''
        const myLid = (sock.user as { lid?: string })?.lid ?? ''
        participantString = myLid
          ? myLid.split(':')[0] + '@lid'
          : myJid
          ? myJid.split(':')[0] + '@s.whatsapp.net'
          : participantString
      } else {
        const meIdent = await this.identityRepository.findMeIdentity()
        if (meIdent?.phoneNumber) {
          participantString = meIdent.phoneNumber
        }
      }
    }
    return participantString
  }

  /**
   * Resolves the JID of the author of a reaction.
   */
  async resolveReactorJid(reactionKey: WAMessageKey, sock: ISocketUserContext | null): Promise<string | null> {
    let reactorJid: string | null =
      (reactionKey.participant ??
      (reactionKey.remoteJid?.endsWith('@g.us') ? null : reactionKey.remoteJid)) ?? null

    if (reactionKey.fromMe) {
      if (sock?.user) {
        const myRawJid = sock.user.id ?? ''
        const myLid = (sock.user as unknown as { lid?: string })?.lid ?? ''
        reactorJid = myLid
          ? myLid.split(':')[0] + '@lid'
          : myRawJid
          ? myRawJid.split(':')[0] + '@s.whatsapp.net'
          : reactorJid
      } else {
        const meIdent = await this.identityRepository.findMeIdentity()
        if (meIdent?.phoneNumber) {
          reactorJid = meIdent.phoneNumber
        }
      }
    }
    return reactorJid ? cleanJid(reactorJid) : null
  }

  /**
   * Resolves the database ID of the sender's identity, upserting the contact if needed.
   */
  async resolveSenderId(jid: string): Promise<number | null> {
    let senderId = await this.contactService.getIdentityIdByJid(jid)
    if (!senderId) {
      await this.contactService.upsertContact({ id: jid })
      senderId = await this.contactService.getIdentityIdByJid(jid)
    }
    return senderId
  }

  /**
   * Resolves the database ID of the "me" sender's identity.
   */
  async resolveMeSenderId(sock: ISocketUserContext | null): Promise<number | null> {
    const meIdent = await this.identityRepository.findMeIdentity()
    if (meIdent) {
      return meIdent.id
    }
    const myRawJid = sock?.user?.id
    const myJidClean = myRawJid ? myRawJid.split(':')[0] : null
    if (myJidClean) {
      let myId = await this.contactService.getIdentityIdByJid(myJidClean)
      if (!myId) {
        const myLid = (sock?.user as unknown as { lid?: string })?.lid?.split(':')[0]
        if (myLid) {
          myId = await this.contactService.getIdentityIdByJid(myLid)
        }
      }
      return myId
    }
    return null
  }

  /**
   * Reconciles LID and PN mapping from JIDs extracted from events.
   */
  async reconcileLidPnFromJids(jids: string[], source: string): Promise<void> {
    await this.identityReconciliationService.reconcileLidPnFromJids(jids, source)
  }

  /**
   * Links a LID and PN directly.
   */
  async linkLidAndPn(lid: string, pn: string, source: string): Promise<void> {
    await this.contactService.linkLidAndPn(lid, pn, source)
  }

  /**
   * Upserts the contact name and notifies in push updates.
   */
  async upsertContactPushName(jid: string, pushName: string): Promise<void> {
    await this.contactService.upsertContact(
      { id: jid, name: pushName, notify: pushName },
      { overwriteName: false }
    )
  }
}
