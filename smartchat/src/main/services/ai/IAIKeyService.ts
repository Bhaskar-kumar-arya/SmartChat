export type ProviderKeys = Record<string, string>;

export interface IAIKeyService {
  getKeys(): ProviderKeys;
  getKey(provider: string): string;
  saveKey(provider: string, key: string): void;
}

