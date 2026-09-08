import { z } from 'zod'

export interface WhenLeaf {
  field: string
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin'
  value: string | number | boolean | string[]
}

export type WhenCondition =
  | { all: WhenCondition[] }
  | { any: WhenCondition[] }
  | { not: WhenCondition }
  | WhenLeaf

export interface SlashCommand {
  name: string
  description: string
}

export interface CronEntry {
  name: string
  cron: string
}

export type PermissionCapability = string

export interface SubMenuItemDeclaration {
  id: string
  label: string
  icon?: string
  args?: Record<string, unknown>
  subMenu?: SubMenuItemDeclaration[]
}

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

const CronEntrySchema = z.object({
  name: z.string(),
  cron: z.string()
})

const WhenLeafSchema = z.object({
  field: z.string(),
  op: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'nin']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
})

const WhenConditionSchema: z.ZodType<WhenCondition> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(WhenConditionSchema) }),
    z.object({ any: z.array(WhenConditionSchema) }),
    z.object({ not: WhenConditionSchema }),
    WhenLeafSchema
  ])
)

const SubMenuItemSchema: z.ZodType<SubMenuItemDeclaration> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    icon: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    subMenu: z.array(SubMenuItemSchema).optional()
  })
)

const ContributionsDeclarationSchema = z.object({
  chatActions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    icon: z.string().optional(),
    when: WhenConditionSchema.optional(),
    subMenu: z.array(SubMenuItemSchema).optional()
  })).optional(),
  messageActions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    icon: z.string().optional(),
    when: WhenConditionSchema.optional(),
    subMenu: z.array(SubMenuItemSchema).optional()
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

// A plugin id is used verbatim as a filesystem directory name by the loader —
// keep it to a single safe path segment (matches PLUGIN_ID_RE in the app's
// kernel/plugins/PluginManifest.ts).
const PLUGIN_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
// `main` is joined onto the plugin directory and used as the worker entry —
// it must be a non-escaping relative path (no absolute paths, no `..`).
const isSafeRelativeMain = (m: string): boolean =>
  m.length > 0 &&
  !m.includes('..') &&
  !/^[/\\]/.test(m) &&
  !/^[a-zA-Z]:[/\\]/.test(m)

const ManifestSchema = z.object({
  id: z
    .string({ message: 'Missing or invalid "id"' })
    .refine((v) => !v.includes('..') && PLUGIN_ID_RE.test(v), {
      message:
        'Invalid "id": must match [a-zA-Z0-9._-], start alphanumeric, and cannot contain ".." or path separators'
    }),
  name: z.string({ message: 'Missing or invalid "name"' }),
  version: z.string({ message: 'Missing or invalid "version"' }),
  apiVersion: z.string({ message: 'Missing or invalid "apiVersion"' }),
  main: z
    .string({ message: 'Missing or invalid "main"' })
    .refine(isSafeRelativeMain, {
      message:
        'Invalid "main": must be a relative path inside the plugin directory (no "..", no absolute paths)'
    }),
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
