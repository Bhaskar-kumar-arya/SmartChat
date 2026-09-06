import path from 'path';
import { ISecureFileRegistry } from './ISecureFileRegistry';

export class SecureFileRegistry implements ISecureFileRegistry {
  private readonly allowedDirectories = new Map<string, string>();
  private readonly grantedFiles = new Set<string>();

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

    // Prevent Directory Traversal (LFI) - the resolved path must be the base dir
    // itself or a path strictly *inside* it. A bare `startsWith(baseDir)` check
    // is insufficient: it also matches sibling dirs like `<baseDir>-backup`.
    if (resolvedPath !== baseDir && !resolvedPath.startsWith(baseDir + path.sep)) {
      console.warn(`[SecureFileRegistry] Attempted directory traversal detected for host: ${host}, path: ${relativePath}`);
      return null;
    }

    return resolvedPath;
  }

  public grantFile(absolutePath: string): void {
    this.grantedFiles.add(path.resolve(absolutePath));
  }

  public isFileGranted(absolutePath: string): boolean {
    return this.grantedFiles.has(path.resolve(absolutePath));
  }
}
