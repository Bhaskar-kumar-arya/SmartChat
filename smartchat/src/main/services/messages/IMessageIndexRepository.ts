export interface IMessageIndexRepository {
  findMessagesWithTextContent(): Promise<Array<{ id: string; textContent: string | null }>>
}
