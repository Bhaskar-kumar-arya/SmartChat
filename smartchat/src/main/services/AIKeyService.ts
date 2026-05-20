import { app } from 'electron';
import fs from 'fs';
import { join } from 'path';

export interface ProviderKeys {
  gemini: string;
  groq: string;
  mistral: string;
  deepseek: string;
}

class AIKeyService {
  private keysPath: string;
  private keys: ProviderKeys;

  // Ultimate out-of-the-box hardcoded fallbacks
  private static readonly DEFAULTS: ProviderKeys = {
    gemini: 'AIzaSyDTfVHNlBOGLdgRSGISCPccYCq9-YLRGd0',
    groq: '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',
    mistral: 'JqcJs0EukbZsMlpP4XYO3anDyNmzftQp',
    deepseek: 'sk-a96018659be1476485d5043356483922'
  };

  constructor() {
    this.keysPath = join(app.getPath('userData'), 'provider_keys.json');
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

    // 3. Override with locally persisted JSON user configuration
    if (fs.existsSync(this.keysPath)) {
      try {
        const fileContent = fs.readFileSync(this.keysPath, 'utf8');
        const savedKeys = JSON.parse(fileContent);
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
  }

  getKeys(): ProviderKeys {
    return { ...this.keys };
  }

  getKey(provider: keyof ProviderKeys): string {
    return this.keys[provider];
  }

  saveKey(provider: keyof ProviderKeys, key: string): void {
    this.keys[provider] = key;
    try {
      const dir = join(app.getPath('userData'));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.keysPath, JSON.stringify(this.keys, null, 2), 'utf8');
      console.log(`[AIKeyService] Dynamic API key persisted for provider: ${provider}`);
    } catch (err) {
      console.error('[AIKeyService] Failed to persist provider keys:', err);
    }
  }
}

export const aiKeyService = new AIKeyService();
