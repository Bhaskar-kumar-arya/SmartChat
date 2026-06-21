import { IBaseAIProvider } from './IBaseAIProvider';

export interface IApiKeyAwareProvider extends IBaseAIProvider {
  /**
   * Dynamically re-initializes client SDK when user changes settings keys.
   */
  updateApiKey(apiKey: string): void;
}
