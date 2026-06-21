import { IStreamingProvider } from './IStreamingProvider';
import { IFullResponseProvider } from './IFullResponseProvider';

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
   * Returns the system prompt for this provider.
   */
  getSystemPrompt(useThinkMode: boolean, userDetails?: unknown): string;

  /**
   * Cleans up resources (e.g., unloading models on exit).
   */
  cleanup(): Promise<void>;

  /**
   * Returns a list of available models for this provider.
   */
  getAvailableModels(): Promise<ModelInfo[]>;

  /**
   * Dynamically re-initializes client SDK when user changes settings keys.
   */
  updateApiKey?(apiKey: string): void;
}

export interface AIProvider extends IStreamingProvider, IFullResponseProvider {}
