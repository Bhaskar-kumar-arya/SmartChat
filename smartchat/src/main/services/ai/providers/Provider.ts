export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description?: string;
  isLocal: boolean;
}

export interface AIProvider {
  /**
   * Determines if this provider can handle the given model ID.
   */
  canHandleModel(modelId: string): boolean;

  /**
   * Returns the system prompt for this provider.
   */
  getSystemPrompt(useThinkMode: boolean, userDetails?: unknown): string;

  /**
   * Cleans up resources (e.g., unloading models on exit).
   */
  cleanup(): Promise<void>;

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

  /**
   * Generates a full response.
   */
  generateResponse(
    prompt: string,
    history: Array<{ role: string; content: string; isSystem?: boolean }>,
    options: { model?: string; [key: string]: unknown },
    signal?: AbortSignal
  ): Promise<string>;

  /**
   * Returns a list of available models for this provider.
   */
  getAvailableModels(): Promise<ModelInfo[]>;

  /**
   * Dynamically re-initializes client SDK when user changes settings keys.
   */
  updateApiKey?(apiKey: string): void;
}
