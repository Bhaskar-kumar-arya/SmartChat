export interface ProviderKeys {
  gemini: string;
  groq: string;
  mistral: string;
  deepseek: string;
  [key: string]: string;
}

export interface IAIKeyService {
  getKeys(): ProviderKeys;
  getKey(provider: keyof ProviderKeys): string;
  saveKey(provider: keyof ProviderKeys, key: string): void;
}
