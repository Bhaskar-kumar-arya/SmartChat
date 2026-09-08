import path from 'path';
import { ISecureFileRegistry } from './ISecureFileRegistry';

export class SecureFileRegistry implements ISecureFileRegistry {
  private readonly allowedDirectories = new Map<string, string>();
  private readonly grantedFiles = new Set<string>();

  // win32 paths are case-insensitive; lowercase them before any containment
  // comparison so drive-letter casing differences don't cause false denials.
  private static normalizeForCompare(p: string): string {
    return process.platform === 'win32' ? p.toLowerCase() : p;
  }

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
    // On win32 the filesystem is case-insensitive and `path.resolve` can emit a
    // drive letter in a different case than the registered base (`C:\` vs `c:\`),
    // which would wrongly *deny* a valid path — so compare case-normalized there.
    const cmpResolved = SecureFileRegistry.normalizeForCompare(resolvedPath);
    const cmpBase = SecureFileRegistry.normalizeForCompare(baseDir);
    if (cmpResolved !== cmpBase && !cmpResolved.startsWith(cmpBase + path.sep)) {
      console.warn(`[SecureFileRegistry] Attempted directory traversal detected for host: ${host}, path: ${relativePath}`);
      return null;
    }

    return resolvedPath;
  }

  public grantFile(absolutePath: string): void {
    // Key on the case-normalized path (win32) for the same reason resolvePath
    // normalizes: a granted path and a later request can differ only in drive-
    // letter / segment casing, which must not cause a false denial.
    this.grantedFiles.add(SecureFileRegistry.normalizeForCompare(path.resolve(absolutePath)));
  }

  public isFileGranted(absolutePath: string): boolean {
    return this.grantedFiles.has(SecureFileRegistry.normalizeForCompare(path.resolve(absolutePath)));
  }
}
