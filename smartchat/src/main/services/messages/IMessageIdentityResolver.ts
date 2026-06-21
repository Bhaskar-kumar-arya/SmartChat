import { IIdentityRepository } from '../contacts/IIdentityRepository'
import { ISocketUserContext } from '../contacts/IContactService'
import { WAMessageKey } from '../whatsapp/types'

export interface IMessageIdentityResolver {
  readonly identityRepository: IIdentityRepository

  resolveSenderJid(key: WAMessageKey, sock: ISocketUserContext | null): Promise<string | null>
  resolveReactorJid(reactionKey: WAMessageKey, sock: ISocketUserContext | null): Promise<string | null>
  resolveSenderId(jid: string): Promise<number | null>
  resolveMeSenderId(sock: ISocketUserContext | null): Promise<number | null>
  reconcileLidPnFromJids(jids: string[], source: string): Promise<void>
  linkLidAndPn(lid: string, pn: string, source: string): Promise<void>
  upsertContactPushName(jid: string, pushName: string): Promise<void>
}
