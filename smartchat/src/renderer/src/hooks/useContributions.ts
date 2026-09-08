import { useContributionSnapshot } from '../context/ContributionContext'
import { ContributionMap, ContributionSlot } from '../types/contribution.types'

// Stable reference for the "empty slot" path so consumers using the result in a
// dependency array / memoized-child prop don't re-run every render.
const EMPTY: readonly never[] = Object.freeze([])

export function useContributions<K extends ContributionSlot>(slot: K): ContributionMap[K][] {
  const snapshot = useContributionSnapshot()
  const list = snapshot[slot]
  if (!list) {
    return EMPTY as unknown as ContributionMap[K][]
  }
  return list as ContributionMap[K][]
}
