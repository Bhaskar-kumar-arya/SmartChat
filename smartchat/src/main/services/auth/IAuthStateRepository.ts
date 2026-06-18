export interface IAuthStateRepository {
  getValue(key: string): Promise<string | null>
  setValue(key: string, value: string): Promise<void>
  deleteValue(key: string): Promise<void>
}
