/**
 * F8-13: single source of truth for extracting a `<tool_call>` block from AI
 * output. Previously the regex + JSON-in-fence stripping was duplicated
 * verbatim in `useAIStream` and `AIMessageBubble` and could drift.
 */
export interface ParsedToolCall {
  /** Raw inner text of the <tool_call> block. */
  raw: string
  /** Parsed JSON payload, or null if it failed to parse. */
  data: { tool?: string; arguments?: Record<string, unknown>; [k: string]: unknown } | null
  /** Parse error message, if any. */
  error: string | null
}

const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/

export function parseToolCall(content: string): ParsedToolCall | null {
  const match = content.match(TOOL_CALL_RE)
  if (!match) return null

  const raw = match[1].trim()
  const jsonStr = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  try {
    return { raw, data: JSON.parse(jsonStr), error: null }
  } catch (e) {
    return { raw, data: null, error: e instanceof Error ? e.message : String(e) }
  }
}
