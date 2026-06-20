export interface IAuthSettingsService {
  getSyncFullHistory(): Promise<boolean>
  setSyncFullHistory(enabled: boolean): Promise<void>
  getHistorySyncCompleted(): Promise<boolean>
  setHistorySyncCompleted(): Promise<void>
  clearHistorySyncCompleted(): Promise<void>
  hasCreds(): Promise<boolean>
}
