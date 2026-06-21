import { IIdentityRepository } from '../contacts/IIdentityRepository'
import { WASocket, WAMessageKey } from '../whatsapp/types'

export interface IMessageIdentityResolver {
  readonly identityRepository: IIdentityRepository

  resolveSenderJid(key: WAMessageKey, sock: WASocket | null): Promise<string | null>
  resolveReactorJid(reactionKey: WAMessageKey, sock: WASocket | null): Promise<string | null>
  resolveSenderId(jid: string): Promise<number | null>
  resolveMeSenderId(sock: WASocket | null): Promise<number | null>
  reconcileLidPnFromJids(jids: string[], source: string): Promise<void>
  linkLidAndPn(lid: string, pn: string, source: string): Promise<void>
  upsertContactPushName(jid: string, pushName: string): Promise<void>
}
