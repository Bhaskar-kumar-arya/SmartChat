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

  groupFetchAllParticipating(): Promise<any>;

  groupMetadata(jid: string): Promise<any>;

  logout(): Promise<void>;

  skipSync(): Promise<void>;
}
