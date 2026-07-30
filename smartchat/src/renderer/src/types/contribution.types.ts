import type { ContributionMap, ContributionSlot } from '../../../main/kernel/contributions/ContributionPoints'

export type { ContributionMap, ContributionSlot }

export type ContributionRegistrySnapshot = {
  [K in ContributionSlot]?: ContributionMap[K][]
} & {
  panelIds?: Record<string, string>
}


export interface ExecuteContributionOpts {
  slot: ContributionSlot
  pluginId: string
  id: string
  context?: Record<string, unknown>
}
