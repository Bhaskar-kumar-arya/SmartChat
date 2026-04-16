export interface ModelInfo {
  id: string;
  name: string;
  provider: 'gemini' | 'lmstudio';
  description?: string;
  isLocal: boolean;
}

export interface AIProvider {
  /**
   * Returns the system prompt for this provider.
   */
  getSystemPrompt(useThinkMode: boolean): string;

  /**
   * Cleans up resources (e.g., unloading models on exit).
   */
  cleanup(): Promise<void>;

  /**
   * Generates a streaming response.
   */
  generateResponseStream(
    prompt: string,
    history: any[],
    options: any,
    onChunk: (chunk: string) => void
  ): Promise<void>;

  /**
   * Generates a full response.
   */
  generateResponse(
    prompt: string,
    history: any[],
    options: any
  ): Promise<string>;

  /**
   * Returns a list of available models for this provider.
   */
  getAvailableModels(): Promise<ModelInfo[]>;
}
