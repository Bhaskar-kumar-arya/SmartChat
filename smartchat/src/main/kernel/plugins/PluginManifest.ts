import { WhenCondition } from '../contributions/WhenCondition'
import { SubMenuItemDeclaration } from '../contributions/SubMenuItemDeclaration'

export interface SlashCommand {
  name: string
  description: string
}

export interface CronEntry {
  name: string
  cron: string
}

export type PermissionCapability = string

export interface ContributionsDeclaration {
  chatActions?: Array<{ id: string; label: string; icon?: string; when?: WhenCondition; subMenu?: SubMenuItemDeclaration[] }>
  messageActions?: Array<{ id: string; label: string; icon?: string; when?: WhenCondition; subMenu?: SubMenuItemDeclaration[] }>
  chatBadges?: Array<{ id: string; label?: string }>
  messageRenderers?: Array<{ id: string; messageType: string }>
  slashCommands?: SlashCommand[]
  sidebarPanels?: Array<{ id: string; title: string; icon?: string; panel?: string }>
  settingsPages?: Array<{ id: string; title: string; panel?: string }>
  aiTools?: Array<{ name: string; description: string; schema: object }>
  keyboardShortcuts?: Array<{ id: string; defaultBinding: string; description: string }>
  statusBarItems?: Array<{ id: string; alignment: 'left' | 'right' }>
  chatFilters?: Array<{ id: string; label: string; icon?: string }>
  chatSortStrategies?: Array<{ id: string; label: string }>
  completionProviders?: Array<{ id: string; trigger: string; context: 'chatbar' | 'search' }>
  messageSendPipeline?: Array<{ id: string; priority: number }>
  pluginApiExports?: string[]
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: '2'
  main: string
  permissions: PermissionCapability[]
  contributions: ContributionsDeclaration
  description?: string
  scheduler?: {
    onStart: boolean
    intervals: CronEntry[]
  }
}

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestValidationError'
  }
}

export class ApiVersionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ApiVersionError'
  }
}

export function validateManifest(raw: unknown): PluginManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new ManifestValidationError('Manifest is not a valid object')
  }

  const obj = raw as Record<string, unknown>

  if (!obj.id || typeof obj.id !== 'string') {
    throw new ManifestValidationError('Missing or invalid "id"')
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
