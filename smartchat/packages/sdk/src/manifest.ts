import { z } from 'zod'

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
  chatActions?: Array<{ id: string; label: string; icon?: string; when?: string }>
  messageActions?: Array<{ id: string; label: string; icon?: string; when?: string }>
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

const CronEntrySchema = z.object({
  name: z.string(),
  cron: z.string()
})

const ContributionsDeclarationSchema = z.object({
  chatActions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    icon: z.string().optional(),
    when: z.string().optional()
  })).optional(),
  messageActions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    icon: z.string().optional(),
    when: z.string().optional()
  })).optional(),
  chatBadges: z.array(z.object({
    id: z.string(),
    label: z.string().optional()
  })).optional(),
  messageRenderers: z.array(z.object({
    id: z.string(),
    messageType: z.string()
  })).optional(),
  slashCommands: z.array(z.object({
    name: z.string(),
    description: z.string()
  })).optional(),
  sidebarPanels: z.array(z.object({
    id: z.string(),
    title: z.string(),
    icon: z.string().optional(),
    panel: z.string().optional()
  })).optional(),
  settingsPages: z.array(z.object({
    id: z.string(),
    title: z.string(),
    panel: z.string().optional()
  })).optional(),
  aiTools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    schema: z.record(z.string(), z.unknown())
  })).optional(),
  keyboardShortcuts: z.array(z.object({
    id: z.string(),
    defaultBinding: z.string(),
    description: z.string()
  })).optional(),
  statusBarItems: z.array(z.object({
    id: z.string(),
    alignment: z.enum(['left', 'right'])
  })).optional(),
  chatFilters: z.array(z.object({
    id: z.string(),
    label: z.string(),
    icon: z.string().optional()
  })).optional(),
  chatSortStrategies: z.array(z.object({
    id: z.string(),
    label: z.string()
  })).optional(),
  completionProviders: z.array(z.object({
    id: z.string(),
    trigger: z.string(),
    context: z.enum(['chatbar', 'search'])
  })).optional(),
  messageSendPipeline: z.array(z.object({
    id: z.string(),
    priority: z.number()
  })).optional(),
  pluginApiExports: z.array(z.string()).optional()
})

const ManifestSchema = z.object({
  id: z.string({ message: 'Missing or invalid "id"' }),
  name: z.string({ message: 'Missing or invalid "name"' }),
  version: z.string({ message: 'Missing or invalid "version"' }),
  apiVersion: z.string({ message: 'Missing or invalid "apiVersion"' }),
  main: z.string({ message: 'Missing or invalid "main"' }),
  permissions: z.array(z.string(), { message: 'Permissions must be an array' }),
  contributions: ContributionsDeclarationSchema,
  description: z.string().optional(),
  scheduler: z.object({
    onStart: z.boolean(),
    intervals: z.array(CronEntrySchema)
  }).optional()
})

export function validateManifest(raw: unknown): PluginManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new ManifestValidationError('Manifest is not a valid object')
  }

  const parseResult = ManifestSchema.safeParse(raw)
  if (!parseResult.success) {
    const firstError = parseResult.error.issues[0]
    throw new ManifestValidationError(firstError?.message || 'Invalid manifest format')
  }

  const manifest = parseResult.data
  if (manifest.apiVersion !== '2') {
    throw new ApiVersionError(`Unsupported API version: ${manifest.apiVersion}. Expected '2'`)
  }

  return manifest as PluginManifest
}
