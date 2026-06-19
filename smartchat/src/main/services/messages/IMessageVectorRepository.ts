export interface IMessageVectorRepository {
  searchVectorMatch(
    queryVectorJson: string,
    candidateIds?: string[]
  ): Promise<Array<{ messageId: string; distance: number }>>;

  upsertVector(messageId: string, vectorJson: string): Promise<void>;
  deleteFromVecMessages(messageId: string): Promise<void>;
  insertIntoVecMessages(messageId: string, vectorJson: string): Promise<void>;
  getAllIndexedMessageIds(): Promise<string[]>;
  clearAllVectors(): Promise<void>;
  getAllVectors(): Promise<Array<{ messageId: string; vector: string }>>;
  deleteVector(messageId: string): Promise<void>;
}
