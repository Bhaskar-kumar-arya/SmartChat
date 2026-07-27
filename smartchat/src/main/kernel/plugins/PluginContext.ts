import { PluginManifest } from './PluginManifest'
import {
  IPluginLogAPI,
  IPluginChatsAPI,
  IPluginMessagesAPI,
  IPluginContactsAPI,
  IPluginAIAPI,
  IPluginEventsAPI,
  IPluginStorageAPI,
  IPluginUIAPI,
  IPluginSchedulerAPI,
  IPluginContributionsAPI
} from '../../../../packages/sdk/src/context'

export type {
  IPluginLogAPI,
  IPluginChatsAPI,
  IPluginMessagesAPI,
  IPluginContactsAPI,
  IPluginAIAPI,
  IPluginEventsAPI,
  IPluginStorageAPI,
  IPluginUIAPI,
  IPluginSchedulerAPI,
  IPluginContributionsAPI
}

export interface PluginContext {
  readonly id: string
  readonly manifest: PluginManifest

  onActivate?(fn: () => Promise<void>): void
  onDeactivate?(fn: () => Promise<void>): void

  readonly log: IPluginLogAPI
  readonly chats?: IPluginChatsAPI
  readonly messages?: IPluginMessagesAPI
  readonly contacts?: IPluginContactsAPI
  readonly ai?: IPluginAIAPI
  readonly events?: IPluginEventsAPI
  readonly storage?: IPluginStorageAPI
  readonly ui?: IPluginUIAPI
  readonly scheduler?: IPluginSchedulerAPI
  readonly contributions: IPluginContributionsAPI
}
