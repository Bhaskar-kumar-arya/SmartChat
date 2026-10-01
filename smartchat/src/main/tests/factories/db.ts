import type { Chat, ChatMember, Identity, IdentityAlias, LidMap, Message, PrismaClient, Reaction } from '@prisma/client'

/** Monotonic counter so every factory call yields unique, readable ids within a worker. */
let seq = 0
export function nextSeq(): number {
  return ++seq
}

/** Test-only: restart the counter (e.g. for deterministic ids in a describe block). */
export function resetFactorySeq(): void {
  seq = 0
}

export const PN_SUFFIX = '@s.whatsapp.net'
export const LID_SUFFIX = '@lid'
export const GROUP_SUFFIX = '@g.us'

/** Unique phone-number JID, e.g. 9190000000001@s.whatsapp.net */
export function pnJid(n: number = nextSeq()): string {
  return `${9190000000000 + n}${PN_SUFFIX}`
}
/** Unique LID JID, e.g. 100000000001@lid */
export function lidJid(n: number = nextSeq()): string {
  return `${100000000000 + n}${LID_SUFFIX}`
}
/** Unique group JID, e.g. 120363000000001@g.us */
export function groupJid(n: number = nextSeq()): string {
  return `${120363000000000 + n}${GROUP_SUFFIX}`
}

export async function makeIdentity(
  prisma: PrismaClient,
  overrides: Partial<Identity> = {}
): Promise<Identity> {
  return prisma.identity.create({ data: { ...overrides } })
}

export async function makeAlias(
  prisma: PrismaClient,
  identityId: number,
  jid: string,
  type: 'PN' | 'LID' | 'BOT' = jid.endsWith(LID_SUFFIX) ? 'LID' : 'PN'
): Promise<IdentityAlias> {
  return prisma.identityAlias.create({ data: { jid, type, identityId } })
}

/**
 * A contact: an Identity plus its PN alias (and an optional LID alias).
 * `phoneNumber` on the Identity is set to the PN jid, matching production writes.
 */
export async function makeContact(
  prisma: PrismaClient,
  opts: {
    pn?: string
    lid?: string | null
    displayName?: string | null
    pushName?: string | null
    isMe?: boolean
  } = {}
): Promise<{ identity: Identity; pn: string; lid: string | null }> {
  const pn = opts.pn ?? pnJid()
  const lid = opts.lid ?? null
  const identity = await makeIdentity(prisma, {
    phoneNumber: pn,
    displayName: opts.displayName ?? null,
    pushName: opts.pushName ?? null,
    isMe: opts.isMe ?? false
  })
  await makeAlias(prisma, identity.id, pn, 'PN')
  if (lid) await makeAlias(prisma, identity.id, lid, 'LID')
  return { identity, pn, lid }
}

export async function makeChat(prisma: PrismaClient, overrides: Partial<Chat> = {}): Promise<Chat> {
  const type = overrides.type ?? 'DM'
  const jid = overrides.jid ?? (type === 'DM' ? pnJid() : groupJid())
  return prisma.chat.create({ data: { ...overrides, jid, type } })
}

export async function makeChatMember(
  prisma: PrismaClient,
  chatJid: string,
  identityId: number,
  overrides: Partial<Omit<ChatMember, 'chatJid' | 'identityId'>> = {}
): Promise<ChatMember> {
  return prisma.chatMember.create({ data: { chatJid, identityId, ...overrides } })
}

export async function makeMessage(
  prisma: PrismaClient,
  chatJid: string,
  overrides: Partial<Message> = {}
): Promise<Message> {
  const n = nextSeq()
  const text = overrides.textContent === undefined ? `message ${n}` : overrides.textContent
  return prisma.message.create({
    data: {
      id: `MSG_${n}`,
      fromMe: false,
      timestamp: BigInt(1_700_000_000 + n),
      messageType: 'conversation',
      textContent: text,
      content: JSON.stringify({ conversation: text }),
      ...overrides,
      chatJid
    }
  })
}

export async function makeReaction(
  prisma: PrismaClient,
  messageId: string,
  senderId: number,
  overrides: Partial<Omit<Reaction, 'messageId' | 'senderId'>> = {}
): Promise<Reaction> {
  return prisma.reaction.create({
    data: {
      text: '👍',
      timestamp: BigInt(1_700_000_000 + nextSeq()),
      ...overrides,
      messageId,
      senderId
    }
  })
}

export async function makeLidMap(prisma: PrismaClient, overrides: Partial<LidMap> = {}): Promise<LidMap> {
  const n = nextSeq()
  return prisma.lidMap.create({
    data: {
      lid: lidJid(n),
      pn: pnJid(n),
      source: 'test',
      lastSeenDateTime: BigInt(1_700_000_000 + n),
      ...overrides
    }
  })
}
