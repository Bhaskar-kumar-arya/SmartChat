import { WASocket, MessageReceiptUpdate, BaileysMessage } from './types'

export interface IReceiptService {
  processMessageStatusUpdate(
    key: BaileysMessage['key'] | null | undefined,
    baileysStatus: number
  ): Promise<void>;

  processMessageReceipt(
    update: MessageReceiptUpdate,
    sock: WASocket | null
  ): Promise<void>;

  getMessageReceipts(messageId: string, sock: WASocket | null): Promise<any[]>;
}
