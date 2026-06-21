import { DBMessageWithSender } from '../../domain/types'

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
