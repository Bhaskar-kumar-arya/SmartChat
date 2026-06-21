import { IBaseAIProvider } from './IBaseAIProvider';

export interface IFullResponseProvider extends IBaseAIProvider {
  /**
   * Generates a full response.
   */
  generateResponse(
    prompt: string,
    history: Array<{ role: string; content: string; isSystem?: boolean }>,
    options: { model?: string; [key: string]: unknown },
    signal?: AbortSignal
  ): Promise<string>;
}
