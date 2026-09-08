import React from 'react'
import type { SubMenuItemDeclaration } from '../../../main/kernel/contributions/SubMenuItemDeclaration'
import type { ContributionSlot } from '../types/contribution.types'
import { PluginIcon } from '../components/common/PluginIcon'

export interface ExecuteContributionOpts {
  slot: ContributionSlot
  pluginId: string
  id: string
  context: Record<string, unknown>
}

/**
 * Recursively converts a SubMenuItemDeclaration tree into ContextMenu items.
 * Works for chat actions, message actions, or any contribution slot.
 */
export function mapSubMenuItems(
  subItems: SubMenuItemDeclaration[],
  action: { pluginId: string; id: string },
  slot: ContributionSlot,
  baseContext: Record<string, unknown>,
  executeContribution: (opts: ExecuteContributionOpts) => Promise<unknown>
): Array<{ label: string; icon?: React.ReactNode; onClick?: () => void; subMenu?: any[] }> {
  return subItems.map((sub) => {
    const hasSubMenu = Array.isArray(sub.subMenu) && sub.subMenu.length > 0
    return {
    label: sub.label,
    icon: sub.icon ? <PluginIcon icon={sub.icon} /> : undefined,
    subMenu: hasSubMenu
      ? mapSubMenuItems(sub.subMenu!, action, slot, baseContext, executeContribution)
      : undefined,
    onClick: hasSubMenu
      ? undefined
      : () => {
          executeContribution({
            slot,
            pluginId: action.pluginId,
            id: action.id,
            context: { ...baseContext, ...sub.args }
          }).catch(console.error)
        }
    }
  })
}
