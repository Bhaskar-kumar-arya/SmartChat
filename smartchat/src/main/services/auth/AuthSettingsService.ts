import { AuthStateRepository } from './AuthStateRepository'

/**
 * AuthSettingsService — Orchestrates authState setting flags
 * without exposing raw database client operations.
 */
export class AuthSettingsService {
  constructor(private readonly authStateRepository: AuthStateRepository) {}

  /**
   * Returns true if 'sync_full_history' setting is set to 'true'.
   */
  async getSyncFullHistory(): Promise<boolean> {
    const data = await this.authStateRepository.getValue('sync_full_history')
    return data === 'true'
  }

  /**
   * Updates the 'sync_full_history' setting to 'true' or 'false'.
   */
  async setSyncFullHistory(full: boolean): Promise<void> {
    await this.authStateRepository.setValue('sync_full_history', full ? 'true' : 'false')
  }
}
