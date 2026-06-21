import { DBMessageWithSender } from '../../domain/db.types'

export interface IMessageCompoundRepository {
  updateAndFetchMessageWithSender(
    id: string,
    textContent: string,
    content: string
  ): Promise<DBMessageWithSender | null>
  updateContentAndFetchWithSender(
    id: string,
    content: string
  ): Promise<DBMessageWithSender | null>
}
