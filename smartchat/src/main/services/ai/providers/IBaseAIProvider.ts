export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description?: string;
  isLocal: boolean;
}

export interface IBaseAIProvider {
  /**
   * Determines if this provider can handle the given model ID.
   */
  canHandleModel(modelId: string): boolean;

  /**
   * Cleans up resources (e.g., unloading models on exit).
   */
  cleanup(): Promise<void>;

  /**
   * Returns a list of available models for this provider.
   */
  getAvailableModels(): Promise<ModelInfo[]>;
}

