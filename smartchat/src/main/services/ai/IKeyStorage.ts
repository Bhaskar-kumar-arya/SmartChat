export interface IKeyStorage {
  loadKeys(): Record<string, string>;
  saveKeys(keys: Record<string, string>): void;
}
