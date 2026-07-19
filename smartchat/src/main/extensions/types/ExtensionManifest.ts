export interface SlashCommand {
  name: string
  description: string
}

export interface CronEntry {
  name: string
  cron: string
}

export interface ExtensionManifest {
  id: string
  version: string
  apiVersion: string
  name: string
  description: string
  main: string
  permissions: string[]
  dedicatedChat?: {
    name: string
    avatarEmoji: string
    commands: SlashCommand[]
  }
  scheduler?: {
    onStart: boolean
    intervals: CronEntry[]
  }
}
