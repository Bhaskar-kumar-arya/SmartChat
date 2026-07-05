import path from 'path';
import { ISecureFileRegistry } from './ISecureFileRegistry';

export class SecureFileRegistry implements ISecureFileRegistry {
  private readonly allowedDirectories = new Map<string, string>();

  public registerDirectory(host: string, absolutePath: string): void {
    // Ensure the registered path is normalized and absolute
    this.allowedDirectories.set(host, path.resolve(absolutePath));
  }

  public resolvePath(host: string, relativePath: string): string | null {
    const baseDir = this.allowedDirectories.get(host);
    
    if (!baseDir) {
      return null;
    }

    // Decode URI components in case the URL contains encoded characters
    const decodedRelativePath = decodeURIComponent(relativePath.startsWith('/') ? relativePath.slice(1) : relativePath);
    
    // Resolve the full path
    const resolvedPath = path.resolve(baseDir, decodedRelativePath);

    // Prevent Directory Traversal (LFI) - verify it still starts with the baseDir
    if (!resolvedPath.startsWith(baseDir)) {
      console.warn(`[SecureFileRegistry] Attempted directory traversal detected for host: ${host}, path: ${relativePath}`);
      return null;
    }

    return resolvedPath;
  }
}
