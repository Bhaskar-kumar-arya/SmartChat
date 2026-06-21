import { ISocketUserContext } from '../contacts/IContactService'
import { MessageReceiptUpdate, BaileysMessage } from './types'

export interface IReceiptService {
  processMessageStatusUpdate(
    key: BaileysMessage['key'] | null | undefined,
    baileysStatus: number
  ): Promise<void>;

  processMessageReceipt(
    update: MessageReceiptUpdate,
    sock: ISocketUserContext | null
  ): Promise<void>;

  getMessageReceipts(messageId: string, sock: ISocketUserContext | null): Promise<any[]>;
}
