// Single source of truth: the manifest types, error classes and validation live in the SDK
// (packages/sdk/src/manifest.ts, a zod schema). The kernel only re-exports them, so a plugin
// that passes `smartchat-sdk package` also passes the host's install-time validation.
export {
  validateManifest,
  ManifestValidationError,
  ApiVersionError
} from '../../../../packages/sdk/src/manifest'
export type {
  SlashCommand,
  CronEntry,
  PermissionCapability,
  ContributionsDeclaration,
  PluginManifest
} from '../../../../packages/sdk/src/manifest'
