import { app } from 'electron';
import fs from 'fs';
import { join } from 'path';
import { IKeyStorage } from './IKeyStorage';

export class FSKeyStorage implements IKeyStorage {
  private keysPath: string;

  constructor() {
    this.keysPath = join(app.getPath('userData'), 'provider_keys.json');
  }

  loadKeys(): Record<string, string> {
    if (fs.existsSync(this.keysPath)) {
      try {
        const fileContent = fs.readFileSync(this.keysPath, 'utf8');
        return JSON.parse(fileContent) || {};
      } catch (err) {
        console.error('[FSKeyStorage] Failed to load provider keys:', err);
      }
    }
    return {};
  }

  saveKeys(keys: Record<string, string>): void {
    try {
      const dir = join(app.getPath('userData'));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.keysPath, JSON.stringify(keys, null, 2), 'utf8');
    } catch (err) {
      console.error('[FSKeyStorage] Failed to persist provider keys:', err);
      throw err;
    }
  }
}
