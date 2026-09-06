import { IAIKeyService, ProviderKeys } from './IAIKeyService';
import { IKeyStorage } from './IKeyStorage';

export class AIKeyService implements IAIKeyService {
  private keys: ProviderKeys;

  // No hardcoded API keys are shipped. Keys must come from the environment
  // (GEMINI_API_KEY / GROQ_API_KEY / MISTRAL_API_KEY / DEEPSEEK_API_KEY) or be
  // supplied by the user and persisted locally via saveKey().
  // (Historically live keys were committed here — audit S6-01. Those keys must
  // be revoked/rotated at the provider; removing them from source is not enough.)
  private static readonly DEFAULTS: ProviderKeys = {
    gemini: '',
    groq: '',
    mistral: '',
    deepseek: ''
  };

  constructor(private readonly storage: IKeyStorage) {
    this.keys = { ...AIKeyService.DEFAULTS };
    this.loadKeys();
  }

  private loadKeys(): void {
    // 1. Apply ultimate hardcoded defaults first
    this.keys = { ...AIKeyService.DEFAULTS };

    // 2. Override with system environment variables if defined
    if (process.env.GEMINI_API_KEY) this.keys.gemini = process.env.GEMINI_API_KEY;
    if (process.env.GROQ_API_KEY) this.keys.groq = process.env.GROQ_API_KEY;
    if (process.env.MISTRAL_API_KEY) this.keys.mistral = process.env.MISTRAL_API_KEY;
    if (process.env.DEEPSEEK_API_KEY) this.keys.deepseek = process.env.DEEPSEEK_API_KEY;

    // 3. Override with locally persisted user configuration
    try {
      const savedKeys = this.storage.loadKeys();
      if (savedKeys) {
        if (savedKeys.gemini) this.keys.gemini = savedKeys.gemini;
        if (savedKeys.groq) this.keys.groq = savedKeys.groq;
        if (savedKeys.mistral) this.keys.mistral = savedKeys.mistral;
        if (savedKeys.deepseek) this.keys.deepseek = savedKeys.deepseek;
      }
    } catch (err) {
      console.error('[AIKeyService] Failed to load provider keys:', err);
    }
  }

  getKeys(): ProviderKeys {
    return { ...this.keys };
  }

  getKey(provider: string): string {
    return this.keys[provider];
  }

  saveKey(provider: string, key: string): void {
    this.keys[provider] = key;
    try {
      this.storage.saveKeys(this.keys);
      console.log(`[AIKeyService] Dynamic API key persisted for provider: ${provider}`);
    } catch (err) {
      console.error('[AIKeyService] Failed to persist provider keys:', err);
    }
  }
}
