import { IAuthStateRepository } from './IAuthStateRepository'
import { IAuthSettingsService } from './IAuthSettingsService'

/**
 * AuthSettingsService — Orchestrates authState setting flags
 * without exposing raw database client operations.
 */
export class AuthSettingsService implements IAuthSettingsService {
  constructor(private readonly authStateRepository: IAuthStateRepository) {}

  /**
   * Returns true if 'sync_full_history' setting is set to 'true'.
   */
  async getSyncFullHistory(): Promise<boolean> {
    try {
      const data = await this.authStateRepository.getValue('sync_full_history')
      return data === 'true'
    } catch (err) {
      console.error('[AuthSettingsService] getSyncFullHistory read failed, defaulting to false:', err)
      return false
    }
  }

  /**
   * Updates the 'sync_full_history' setting to 'true' or 'false'.
   */
  async setSyncFullHistory(full: boolean): Promise<void> {
    await this.authStateRepository.setValue('sync_full_history', full ? 'true' : 'false')
  }

  /**
   * Returns true if the initial history sync has been completed.
   */
  async getHistorySyncCompleted(): Promise<boolean> {
    try {
      const data = await this.authStateRepository.getValue('history_sync_completed')
      return data === 'true'
    } catch (err) {
      // Default to "completed" on a transient read error: avoids kicking off a
      // heavy full re-sync on every DB hiccup. A genuinely incomplete sync is
      // re-evaluated on the next launch where the read succeeds.
      console.error('[AuthSettingsService] getHistorySyncCompleted read failed, defaulting to true:', err)
      return true
    }
  }

  /**
   * Marks the history sync as completed.
   */
  async setHistorySyncCompleted(): Promise<void> {
    await this.authStateRepository.setValue('history_sync_completed', 'true')
  }

  /**
   * Clears the history sync completed flag (used on fresh login).
   */
  async clearHistorySyncCompleted(): Promise<void> {
    await this.authStateRepository.deleteValue('history_sync_completed')
  }

  /**
   * Returns true if authentication credentials exist in the database.
   */
  async hasCreds(): Promise<boolean> {
    // Deliberately NOT wrapped in try/catch: a read failure must propagate so
    // callers can fail closed. Swallowing it into `false` here is what caused a
    // logged-in user's database to be wiped (see audit S10-01).
    const data = await this.authStateRepository.getValue('creds')
    return data !== null
  }
}
