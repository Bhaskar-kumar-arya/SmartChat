import * as path from 'path'
import {
  ManifestValidationError,
  ApiVersionError,
  type PluginManifest
} from '../../../../packages/sdk/src/manifest'

// Single source of truth: the manifest types and error classes live in the SDK.
export { ManifestValidationError, ApiVersionError }
export type {
  SlashCommand,
  CronEntry,
  PermissionCapability,
  ContributionsDeclaration,
  PluginManifest
} from '../../../../packages/sdk/src/manifest'

/** A plugin id is used verbatim as a filesystem directory name — keep it to a safe segment. */
const PLUGIN_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

export function validateManifest(raw: unknown): PluginManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new ManifestValidationError('Manifest is not a valid object')
  }

  const obj = raw as Record<string, unknown>

  if (!obj.id || typeof obj.id !== 'string') {
    throw new ManifestValidationError('Missing or invalid "id"')
  }
  if (obj.id.includes('..') || !PLUGIN_ID_RE.test(obj.id)) {
    throw new ManifestValidationError(
      'Invalid "id": must match [a-zA-Z0-9._-], start alphanumeric, and cannot contain ".." or path separators'
    )
  }
  if (!obj.name || typeof obj.name !== 'string') {
    throw new ManifestValidationError('Missing or invalid "name"')
  }
  if (!obj.version || typeof obj.version !== 'string') {
    throw new ManifestValidationError('Missing or invalid "version"')
  }
  if (!obj.main || typeof obj.main !== 'string') {
    throw new ManifestValidationError('Missing or invalid "main"')
  }
  if (obj.main.includes('..') || path.isAbsolute(obj.main) || /^[/\\]/.test(obj.main)) {
    throw new ManifestValidationError(
      'Invalid "main": must be a relative path inside the plugin directory (no "..", no absolute paths)'
    )
  }
  if (!Array.isArray(obj.permissions)) {
    throw new ManifestValidationError('Permissions must be an array')
  }

  if (obj.apiVersion !== '2') {
    if (!obj.apiVersion || typeof obj.apiVersion !== 'string') {
      throw new ManifestValidationError('Missing or invalid "apiVersion"')
    }
    throw new ApiVersionError(`Unsupported API version: ${String(obj.apiVersion)}. Expected '2'`)
  }

  if (!obj.contributions || typeof obj.contributions !== 'object' || Array.isArray(obj.contributions)) {
    throw new ManifestValidationError('Manifest missing required "contributions" object')
  }

  return raw as PluginManifest
}
