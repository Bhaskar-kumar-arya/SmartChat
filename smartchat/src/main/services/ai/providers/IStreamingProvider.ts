import { IBaseAIProvider } from './IBaseAIProvider';

export interface IStreamingProvider extends IBaseAIProvider {
  /**
   * Generates a streaming response.
   */
  generateResponseStream(
    prompt: string,
    history: Array<{ role: string; content: string; isSystem?: boolean }>,
    options: { model?: string; [key: string]: unknown },
    onChunk: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<void>;
}
