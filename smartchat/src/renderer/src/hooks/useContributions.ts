import { useContributionSnapshot } from '../context/ContributionContext'
import { ContributionMap, ContributionSlot } from '../types/contribution.types'

export function useContributions<K extends ContributionSlot>(slot: K): ContributionMap[K][] {
  const snapshot = useContributionSnapshot()
  const list = snapshot[slot]
  if (!list) {
    return []
  }
  return list as ContributionMap[K][]
}
