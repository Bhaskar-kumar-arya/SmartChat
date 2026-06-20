export interface IDataWipeService {
  wipeAllData(): Promise<void>
  wipeUserDataOnly(): Promise<void>
}
