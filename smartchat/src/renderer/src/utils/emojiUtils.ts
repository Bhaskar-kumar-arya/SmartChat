/**
 * Converts a Unicode emoji string into its hyphen-separated hexadecimal unified format.
 * E.g., 😊 -> 1f60a
 * E.g., 👨‍👩‍👧 -> 1f468-200d-1f469-200d-1f467
 */
export function emojiToUnified(emoji: string): string {
  const codePoints: string[] = []
  for (const char of emoji) {
    const cp = char.codePointAt(0)
    if (cp !== undefined) {
      codePoints.push(cp.toString(16).toLowerCase())
    }
  }
  return codePoints.join('-')
}
