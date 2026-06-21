import { ChatItem } from '../types/chatTypes'

/**
 * Computes a fuzzy match score for a query against a target string.
 * Returns a score >= 0 for a match, or -1 for no match.
 */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 100
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  // Exact substring → highest priority
  if (t.includes(q)) {
    const idx = t.indexOf(q)
    const boundary = idx === 0 || t[idx - 1] === ' ' || t[idx - 1] === '-' ? 50 : 0
    return 200 + boundary + Math.round((q.length / t.length) * 100)
  }

  // Fuzzy character-sequence match
  let qi = 0, score = 0, prev = -1
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      const consecutive = prev === ti - 1 ? 3 : 0
      const boundary = ti === 0 || t[ti - 1] === ' ' || t[ti - 1] === '-' ? 2 : 0
      score += 1 + consecutive + boundary
      prev = ti
      qi++
    }
  }
  return qi === q.length ? score : -1
}

/**
 * Filters and ranks a list of ChatItems using fuzzy matching against name and pushName.
 */
export function filterAndRank(items: ChatItem[], query: string, limit = 10): ChatItem[] {
  if (!query) return items.slice(0, limit)
  return items
    .map(item => {
      const name = item.name || item.jid.split('@')[0] || ''
      const push = item.pushName || ''
      const score = Math.max(fuzzyScore(query, name), fuzzyScore(query, push))
      return { item, score }
    })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item }) => item)
}
