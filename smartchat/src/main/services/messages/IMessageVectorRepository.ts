export interface IMessageVectorRepository {
  searchVectorMatch(
    queryVectorJson: string,
    candidateIds?: string[]
  ): Promise<Array<{ messageId: string; distance: number }>>
}
