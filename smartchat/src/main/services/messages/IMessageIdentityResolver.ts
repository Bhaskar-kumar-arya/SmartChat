import { proto } from '@whiskeysockets/baileys'
import { IIdentityRepository } from '../contacts/IIdentityRepository'
import { WASocket } from '../whatsapp/types'

export interface IMessageIdentityResolver {
  readonly identityRepository: IIdentityRepository

  resolveSenderJid(key: proto.IMessageKey, sock: WASocket | null): Promise<string | null>
  resolveReactorJid(reactionKey: proto.IMessageKey, sock: WASocket | null): Promise<string | null>
  resolveSenderId(jid: string): Promise<number | null>
  resolveMeSenderId(sock: WASocket | null): Promise<number | null>
  reconcileLidPnFromJids(jids: string[], source: string): Promise<void>
  linkLidAndPn(lid: string, pn: string, source: string): Promise<void>
  upsertContactPushName(jid: string, pushName: string): Promise<void>
}
