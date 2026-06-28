import { GroupMetadata } from '@whiskeysockets/baileys';

/**
 * Interface abstracting away Baileys socket operations from other main process services.
 * Implemented by components that send commands to the WhatsApp socket (or the worker thread).
 */
export interface IWACommandSender {
  sendMessage(
    jid: string,
    content: unknown,
    options?: unknown
  ): Promise<unknown>;

  readMessages(keys: unknown[]): Promise<void>;

  chatModify(modification: unknown, jid: string): Promise<void>;

  groupFetchAllParticipating(): Promise<Record<string, GroupMetadata>>;

  groupMetadata(jid: string): Promise<GroupMetadata>;

  logout(): Promise<void>;

  skipSync(): Promise<void>;
}
