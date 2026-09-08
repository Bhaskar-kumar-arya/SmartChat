import { useCallback, useEffect, useRef } from 'react'

/**
 * Returns a stable `isMounted()` getter (F12-03).
 *
 * The dominant data-loading shape in this renderer is
 * `const x = await api.getSomething(id); setState(x)` with no guard that the
 * component is still mounted. Every concrete instance flagged in F1–F11 has been
 * fixed in place (see F12-03 in the tracker); this is the shared primitive so
 * new IPC reads have one obvious guard to reach for:
 *
 * ```ts
 * const isMounted = useIsMounted()
 * const data = await api.getThing(id)
 * if (isMounted()) setState(data)
 * ```
 */
export function useIsMounted(): () => boolean {
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  return useCallback(() => mountedRef.current, [])
}
