/**
 * Collect Node `unhandledRejection` events raised while a test runs, instead of
 * letting vitest report them as run-level errors. Await `stop()` after the
 * code under test has run: it waits a macrotask so pending rejections have been
 * dispatched, restores the original listeners and returns the captured reasons.
 */
export function captureUnhandledRejections(): { stop: () => Promise<unknown[]> } {
  const original = process.listeners('unhandledRejection')
  process.removeAllListeners('unhandledRejection')
  const seen: unknown[] = []
  const recorder = (reason: unknown): void => {
    seen.push(reason)
  }
  process.on('unhandledRejection', recorder)
  return {
    stop: async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      process.removeListener('unhandledRejection', recorder)
      for (const l of original) process.on('unhandledRejection', l)
      return seen
    }
  }
}
