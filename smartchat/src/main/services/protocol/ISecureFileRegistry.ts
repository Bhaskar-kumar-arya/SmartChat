export interface ISecureFileRegistry {
  /**
   * Registers a safe directory under a specific host name.
   * @param host The host part of the URL (e.g. 'media' in app://media/file.png)
   * @param absolutePath The absolute directory path on disk
   */
  registerDirectory(host: string, absolutePath: string): void;

  /**
   * Resolves a host and relative path to a safe absolute file path.
   * Returns null if the host is not registered or if the path attempts to escape the directory.
   */
  resolvePath(host: string, relativePath: string): string | null;

  /**
   * Grants read access to a single absolute file path (used for files the user
   * explicitly picked via a native dialog, previewed before sending, etc.).
   * This is the only way `app://local/<abs path>` can resolve.
   */
  grantFile(absolutePath: string): void;

  /**
   * Returns true if the given absolute path was previously granted via grantFile.
   */
  isFileGranted(absolutePath: string): boolean;
}
