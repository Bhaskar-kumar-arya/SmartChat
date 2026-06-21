import { proto, WASocket, hmacSign, aesDecryptGCM } from '@whiskeysockets/baileys'
import { PrismaClient } from '@prisma/client'
import { ISecretMessageStrategy, SecretMessageContext } from './ISecretMessageStrategy'
import { MessageEditStrategy } from './MessageEditStrategy'
import { ProcessedMessage } from '../../../domain/db.types'
import { ProtocolResult } from '../types'
import { cleanJid } from '../../../utils'
import { ISecretMessageService } from './ISecretMessageService'

export class SecretMessageService implements ISecretMessageService {
  private strategies = new Map<number | string, ISecretMessageStrategy>()

  constructor(private prisma: PrismaClient) {
    this.registerStrategy(new MessageEditStrategy())
  }

  public registerStrategy(strategy: ISecretMessageStrategy): void {
    this.strategies.set(strategy.getSecretType(), strategy)
  }

  /**
   * Decrypts and handles a SecretEncryptedMessage using registered strategies.
   */
  /**
   * Decrypts and handles a SecretEncryptedMessage or EncReactionMessage using registered strategies.
   */
  async handleSecretMessage(
    msg: proto.IWebMessageInfo,
    sock: WASocket | null
  ): Promise<ProcessedMessage | ProtocolResult | null> {
    const { envelope, strategyKey } = this.extractEnvelopeAndKey(msg)
    if (!envelope || strategyKey === null) return null

    const targetKey = envelope.targetMessageKey
    if (!targetKey || !targetKey.id) {
      console.warn('[SecretMessageService] Encrypted envelope lacks targetMessageKey or id.')
      return null
    }

    const strategy = this.strategies.get(strategyKey)
    if (!strategy) {
      console.warn(`[SecretMessageService] No strategy registered for key: ${strategyKey}`)
      return null
    }

    const messageSecret = await this.loadMessageSecret(targetKey.id)
    if (!messageSecret) {
      console.warn(`[SecretMessageService] Original message secret not found for target ${targetKey.id}. Cannot decrypt.`)
      return null
    }

    if (!envelope.encPayload || !envelope.encIv) {
      console.warn(`[SecretMessageService] Encrypted envelope lacks encPayload or encIv.`)
      return null
    }

    const sender = msg.key?.participant || msg.key?.remoteJid || ''
    const decryptedBytes = this.tryDecrypt(envelope, messageSecret, targetKey.id, sender, strategy.getSigningLabel())
    if (!decryptedBytes) return null

    const context: SecretMessageContext = {
      targetId: targetKey.id,
      remoteJid: cleanJid(targetKey.remoteJid || msg.key?.remoteJid || ''),
      fromMe: targetKey.fromMe ?? false,
      senderJid: cleanJid(sender),
      timestamp: BigInt(this.getTimestampSeconds(msg.messageTimestamp))
    }

    return strategy.handle(decryptedBytes, context, sock)
  }

  private extractEnvelopeAndKey(msg: proto.IWebMessageInfo): {
    envelope: proto.Message.ISecretEncryptedMessage | proto.Message.IEncReactionMessage | null
    strategyKey: number | string | null
  } {
    if (msg.message?.secretEncryptedMessage) {
      return {
        envelope: msg.message.secretEncryptedMessage,
        strategyKey: this.resolveTypeKey(msg.message.secretEncryptedMessage.secretEncType)
      }
    }
    if (msg.message?.encReactionMessage) {
      return {
        envelope: msg.message.encReactionMessage,
        strategyKey: 'encReactionMessage'
      }
    }
    return { envelope: null, strategyKey: null }
  }

  private async loadMessageSecret(targetId: string): Promise<Buffer | null> {
    try {
      const originalMsg = await this.prisma.message.findUnique({
        where: { id: targetId }
      })
      if (!originalMsg || !originalMsg.content) return null

      const parsed = JSON.parse(originalMsg.content) as Record<string, unknown>
      const rawSecret =
        (parsed.messageContextInfo as Record<string, unknown> | undefined)?.messageSecret ??
        ((parsed.message as Record<string, unknown> | undefined)?.messageContextInfo as Record<string, unknown> | undefined)?.messageSecret

      return this.getBufferFromSecret(rawSecret)
    } catch (err: unknown) {
      console.error(`[SecretMessageService] Error loading original message ${targetId}:`, err)
      return null
    }
  }

  private tryDecrypt(
    envelope: proto.Message.ISecretEncryptedMessage | proto.Message.IEncReactionMessage,
    messageSecret: Buffer,
    targetId: string,
    sender: string,
    label: string
  ): Uint8Array | null {
    try {
      return this.decryptPayload(
        envelope.encPayload!,
        envelope.encIv!,
        messageSecret,
        targetId,
        sender,
        label
      )
    } catch (err: unknown) {
      console.error(`[SecretMessageService] Decryption failed for target ${targetId}:`, err)
      return null
    }
  }

  private getTimestampSeconds(ts: unknown): number {
    if (ts && typeof ts === 'object' && 'low' in ts) {
      return (ts as { low: number }).low
    }
    if (typeof ts === 'number') {
      return ts
    }
    return Math.floor(Date.now() / 1000)
  }

  private decryptPayload(
    encPayload: Uint8Array,
    encIv: Uint8Array,
    secret: Uint8Array,
    targetId: string,
    rawSender: string,
    label: string
  ): Uint8Array {
    const attemptDecryption = (sender: string) => {
      const toBinary = (txt: string) => Buffer.from(txt)
      const senderBuf = toBinary(sender)

      // Construct signing input using dynamic strategy label
      const sign = Buffer.concat([
        toBinary(targetId),
        senderBuf,
        senderBuf,
        toBinary(label),
        new Uint8Array([1])
      ])

      const key = hmacSign(secret, new Uint8Array(32))
      const decKey = hmacSign(sign, key)

      return aesDecryptGCM(encPayload, decKey, encIv, new Uint8Array(0))
    }

    try {
      return attemptDecryption(rawSender)
    } catch (err: unknown) {
      const cleaned = cleanJid(rawSender)
      if (cleaned !== rawSender) {
        try {
          return attemptDecryption(cleaned)
        } catch (retryErr: unknown) {
          const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          throw new Error(`Failed to decrypt secret message with both raw and cleaned sender JIDs: ${retryErrMsg}`)
        }
      }
      throw err
    }
  }

  private getBufferFromSecret(rawSecret: unknown): Buffer | null {
    if (!rawSecret) return null
    if (Buffer.isBuffer(rawSecret)) return rawSecret
    if (rawSecret instanceof Uint8Array) return Buffer.from(rawSecret)
    if (typeof rawSecret === 'string') {
      // 1. Try Base64 (usually 44 chars)
      const base64Buf = Buffer.from(rawSecret, 'base64')
      if (base64Buf.length === 32) {
        return base64Buf
      }
      // 2. Try Hex (64 chars)
      const hexBuf = Buffer.from(rawSecret, 'hex')
      if (hexBuf.length === 32) {
        return hexBuf
      }
      // 3. Try Raw Binary string (32 chars)
      const binaryBuf = Buffer.from(rawSecret, 'binary')
      if (binaryBuf.length === 32) {
        return binaryBuf
      }
      // Fallback
      return Buffer.from(rawSecret)
    }
    if (rawSecret && typeof rawSecret === 'object') {
      const obj = rawSecret as Record<string, unknown>
      if (obj.type === 'Buffer' && Array.isArray(obj.data)) {
        return Buffer.from(obj.data as number[])
      }
      if (Object.keys(obj).every(k => !isNaN(Number(k)))) {
        const arr = Object.values(obj).map(Number)
        return Buffer.from(arr)
      }
    }
    if (Array.isArray(rawSecret)) {
      return Buffer.from(rawSecret)
    }
    return null
  }

  private resolveTypeKey(rawType: unknown): number | string {
    if (typeof rawType === 'string') {
      // Resolve string enum to its numeric representation if possible
      const typeEnum = proto.Message.SecretEncryptedMessage.SecretEncType as unknown as Record<string, string | number | undefined>
      const resolved = typeEnum[rawType]
      return resolved !== undefined ? resolved : rawType
    }
    return typeof rawType === 'number' ? rawType : 0
  }
}
