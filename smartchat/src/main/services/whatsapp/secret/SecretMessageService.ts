import { proto, WASocket, hmacSign, aesDecryptGCM } from '@whiskeysockets/baileys'
import { PrismaClient } from '@prisma/client'
import { ISecretMessageStrategy, SecretMessageContext } from './ISecretMessageStrategy'
import { MessageEditStrategy } from './MessageEditStrategy'
import { ProcessedMessage } from '../../../domain/types'
import { ProtocolResult } from '../types'
import { cleanJid } from '../../../utils'

export class SecretMessageService {
  private strategies = new Map<number | string, ISecretMessageStrategy>()

  constructor(private prisma: PrismaClient) {
    this.registerStrategy(new MessageEditStrategy())
  }

  public registerStrategy(strategy: ISecretMessageStrategy) {
    this.strategies.set(strategy.getSecretType(), strategy)
  }

  /**
   * Decrypts and handles a SecretEncryptedMessage using registered strategies.
   */
  /**
   * Decrypts and handles a SecretEncryptedMessage or EncReactionMessage using registered strategies.
   */
  async handleSecretMessage(
    msg: any, // BaileysMessage
    sock: WASocket | null
  ): Promise<ProcessedMessage | ProtocolResult | null> {
    let envelope: any = null
    let strategyKey: number | string | null = null

    if (msg.message?.secretEncryptedMessage) {
      envelope = msg.message.secretEncryptedMessage
      strategyKey = this.resolveTypeKey(envelope.secretEncType)
    } else if (msg.message?.encReactionMessage) {
      envelope = msg.message.encReactionMessage
      strategyKey = 'encReactionMessage'
    }

    if (!envelope) return null

    const targetKey = envelope.targetMessageKey
    if (!targetKey || !targetKey.id) {
      console.warn('[SecretMessageService] Encrypted envelope lacks targetMessageKey or id.')
      return null
    }

    const targetId = targetKey.id
    const remoteJid = cleanJid(targetKey.remoteJid || msg.key.remoteJid || '')
    const fromMe = targetKey.fromMe ?? false
    const sender = msg.key.participant || msg.key.remoteJid || ''

    // Resolve strategy
    const strategy = this.strategies.get(strategyKey!)
    if (!strategy) {
      console.warn(`[SecretMessageService] No strategy registered for key: ${strategyKey}`)
      return null
    }

    // 1. Fetch original message to get the message secret
    let messageSecret: Buffer | null = null
    try {
      const originalMsg = await this.prisma.message.findUnique({
        where: { id: targetId }
      })

      if (originalMsg && originalMsg.content) {
        const parsed = JSON.parse(originalMsg.content)
        const rawSecret =
          parsed.messageContextInfo?.messageSecret ||
          parsed.message?.messageContextInfo?.messageSecret

        messageSecret = this.getBufferFromSecret(rawSecret)
      }
    } catch (err) {
      console.error(`[SecretMessageService] Error loading original message ${targetId}:`, err)
    }

    if (!messageSecret) {
      console.warn(`[SecretMessageService] Original message secret not found for target ${targetId}. Cannot decrypt.`)
      return null
    }

    // 2. Decrypt the payload
    let decryptedBytes: Uint8Array | null = null
    try {
      decryptedBytes = this.decryptPayload(
        envelope.encPayload,
        envelope.encIv,
        messageSecret,
        targetId,
        sender,
        strategy.getSigningLabel()
      )
    } catch (err) {
      console.error(`[SecretMessageService] Decryption failed for target ${targetId}:`, err)
      return null
    }

    const context: SecretMessageContext = {
      targetId,
      remoteJid,
      fromMe,
      senderJid: cleanJid(sender),
      timestamp: BigInt(msg.messageTimestamp ?? Math.floor(Date.now() / 1000))
    }

    return strategy.handle(decryptedBytes, context, sock)
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
    } catch (err: any) {
      const cleaned = cleanJid(rawSender)
      if (cleaned !== rawSender) {
        try {
          return attemptDecryption(cleaned)
        } catch (retryErr: any) {
          throw new Error(`Failed to decrypt secret message with both raw and cleaned sender JIDs: ${retryErr?.message || retryErr}`)
        }
      }
      throw err
    }
  }

  private getBufferFromSecret(rawSecret: any): Buffer | null {
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
    if (typeof rawSecret === 'object') {
      if (rawSecret.type === 'Buffer' && Array.isArray(rawSecret.data)) {
        return Buffer.from(rawSecret.data)
      }
      if (Object.keys(rawSecret).every(k => !isNaN(Number(k)))) {
        const arr = Object.values(rawSecret).map(Number)
        return Buffer.from(arr)
      }
    }
    if (Array.isArray(rawSecret)) {
      return Buffer.from(rawSecret)
    }
    return null
  }

  private resolveTypeKey(rawType: any): number | string {
    if (typeof rawType === 'string') {
      // Resolve string enum to its numeric representation if possible
      const resolved = proto.Message.SecretEncryptedMessage.SecretEncType[rawType]
      return resolved !== undefined ? resolved : rawType
    }
    return typeof rawType === 'number' ? rawType : 0
  }
}
