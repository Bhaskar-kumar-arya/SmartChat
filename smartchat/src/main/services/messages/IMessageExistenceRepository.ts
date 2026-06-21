export interface IMessageExistenceRepository {
  findExistingIds(ids: string[]): Promise<Set<string>>
}
