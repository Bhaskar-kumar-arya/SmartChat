/**
 * Injects all --wa-* design tokens as a <style> block on :root.
 * Call this inside the smartchat:init message handler in overlay HTML files.
 */
export function applyTokens(tokens: Record<string, string>): void {
  if (typeof document === 'undefined') return
  const style = document.createElement('style')
  const vars = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')
  style.textContent = `:root {\n${vars}\n}`
  document.head.appendChild(style)
}
