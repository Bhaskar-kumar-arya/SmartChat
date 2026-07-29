import type {
  WhenCondition,
  ChatWhenContext,
  MessageWhenContext
} from '../../../main/kernel/contributions/WhenCondition'

type WhenContext = ChatWhenContext | MessageWhenContext

/**
 * Evaluates a WhenCondition tree against a flat context object.
 * Returns true if the condition passes (or when is undefined - default allow).
 */
export function evaluateWhen(
  condition: WhenCondition | undefined,
  context: WhenContext
): boolean {
  if (condition === undefined) {
    return true
  }

  // AND
  if ('all' in condition) {
    return condition.all.every((c) => evaluateWhen(c, context))
  }

  // OR
  if ('any' in condition) {
    return condition.any.some((c) => evaluateWhen(c, context))
  }

  // NOT
  if ('not' in condition) {
    return !evaluateWhen(condition.not, context)
  }

  // Leaf comparison
  const ctxValue = (context as unknown as Record<string, unknown>)[condition.field]
  const { op, value } = condition

  switch (op) {
    case 'eq':
      return ctxValue === value
    case 'neq':
      return ctxValue !== value
    case 'gt':
      return typeof ctxValue === 'number' && typeof value === 'number' && ctxValue > value
    case 'gte':
      return typeof ctxValue === 'number' && typeof value === 'number' && ctxValue >= value
    case 'lt':
      return typeof ctxValue === 'number' && typeof value === 'number' && ctxValue < value
    case 'lte':
      return typeof ctxValue === 'number' && typeof value === 'number' && ctxValue <= value
    case 'in':
      return Array.isArray(value) && value.includes(ctxValue as string)
    case 'nin':
      return Array.isArray(value) && !value.includes(ctxValue as string)
    default:
      return true
  }
}
