export interface IMessageWriterService {
  revokeMessageInDb(messageId: string): Promise<void>

  editMessageInDb(
    messageId: string,
    textContent: string | null,
    editedContent: Record<string, unknown> | null
  ): Promise<void>

  decryptMessageInDb(
    messageId: string,
    messageType: string,
    textContent: string | null,
    content: Record<string, unknown>
  ): Promise<void>

  bulkPersistMessages(msgs: unknown[]): Promise<void>
}

