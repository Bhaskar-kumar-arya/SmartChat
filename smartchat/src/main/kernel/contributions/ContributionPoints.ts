import { WhenCondition } from './WhenCondition'
import { SubMenuItemDeclaration } from './SubMenuItemDeclaration'

export interface ChatActionContribution {
  pluginId: string
  id: string
  label: string
  icon?: string
  when?: WhenCondition
  subMenu?: SubMenuItemDeclaration[]
}

export interface MessageActionContribution {
  pluginId: string
  id: string
  label: string
  icon?: string
  when?: WhenCondition
  subMenu?: SubMenuItemDeclaration[]
}

export interface ChatBadgeContribution {
  pluginId: string
  id: string
  label?: string
}

export interface SlashCommandContribution {
  pluginId: string
  name: string
  description: string
}

export interface KeyboardShortcutContribution {
  pluginId: string
  id: string
  defaultBinding: string
  description: string
}

export interface StatusBarItemContribution {
  pluginId: string
  id: string
  alignment: 'left' | 'right'
}

export interface ChatFilterContribution {
  pluginId: string
  id: string
  label: string
  icon?: string
}

export interface ChatSortStrategyContribution {
  pluginId: string
  id: string
  label: string
}

export interface CompletionProviderContribution {
  pluginId: string
  id: string
  trigger: string
  context: 'chatbar' | 'search'
}

export interface SidebarPanelContribution {
  pluginId: string
  id: string
  title: string
  icon?: string
  panel?: string
}

export interface SettingsPageContribution {
  pluginId: string
  id: string
  title: string
  panel?: string
}

export interface AIToolContribution {
  pluginId: string
  name: string
  description: string
  schema: object
}

export interface MessageRendererContribution {
  pluginId: string
  id: string
  messageType: string
  panel?: string
}

export interface MessageSendPipelineContribution {
  pluginId: string
  id: string
  priority: number
}

export interface PluginApiExportContribution {
  pluginId: string
  exportName: string
}

export interface ContributionMap {
  'chat-action': ChatActionContribution
  'message-action': MessageActionContribution
  'chat-badge': ChatBadgeContribution
  'slash-command': SlashCommandContribution
  'keyboard-shortcut': KeyboardShortcutContribution
  'status-bar-item': StatusBarItemContribution
  'chat-filter': ChatFilterContribution
  'chat-sort-strategy': ChatSortStrategyContribution
  'completion-provider': CompletionProviderContribution
  'sidebar-panel': SidebarPanelContribution
  'settings-page': SettingsPageContribution
  'ai-tool': AIToolContribution
  'message-renderer': MessageRendererContribution
  'message-send-pipeline': MessageSendPipelineContribution
  'plugin-api-export': PluginApiExportContribution
}

export type ContributionSlot = keyof ContributionMap
