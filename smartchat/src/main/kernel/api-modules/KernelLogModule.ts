import { BaseKernelModule } from './BaseKernelModule'
import { IPermissionStore } from '../permissions/IPermissionStore'

/** Cap on the serialised `data` blob and the message string written per log line. */
const MAX_LOG_CHARS = 4000
/** Cap on how many `data` array elements are serialised. */
const MAX_DATA_ITEMS = 20
/** Per-plugin log lines allowed per rolling second before further lines are dropped. */
const MAX_LINES_PER_SECOND = 100

export class KernelLogModule extends BaseKernelModule {
  readonly namespace = 'kernel:log'

  /** pluginId -> { windowStart(ms), count } — a crude token bucket to blunt log floods. (S7-04) */
  private readonly rate = new Map<string, { windowStart: number; count: number }>()

  constructor(permissions: IPermissionStore) {
    super(permissions)
  }

  private allowLine(pluginId: string): boolean {
    const now = Date.now()
    const entry = this.rate.get(pluginId)
    if (!entry || now - entry.windowStart >= 1000) {
      this.rate.set(pluginId, { windowStart: now, count: 1 })
      return true
    }
    entry.count += 1
    return entry.count <= MAX_LINES_PER_SECOND
  }

  async handle(pluginId: string, type: string, payload: unknown): Promise<unknown> {
    // `log` is a foundational debugging primitive every plugin relies on, so it
    // is not gated behind a capability — but a plugin (incl. one granted zero
    // capabilities) must not be able to flood the main-process console or force
    // large synchronous serialisations on the main thread. Rate-limit the line
    // rate and hard-cap the serialised payload. (S7-04)
    if (!this.allowLine(pluginId)) {
      return { success: false, dropped: 'rate-limited' }
    }

    const { level, message, data } = (payload as { level?: string; message?: string; data?: unknown[] }) || {}

    let dataStr = ''
    if (data && Array.isArray(data) && data.length > 0) {
      let serialized: string
      try {
        serialized = JSON.stringify(data.slice(0, MAX_DATA_ITEMS))
      } catch {
        serialized = '[unserializable]'
      }
      if (serialized.length > MAX_LOG_CHARS) {
        serialized = `${serialized.slice(0, MAX_LOG_CHARS)}…(+${serialized.length - MAX_LOG_CHARS} chars truncated)`
      }
      dataStr = ` | Data: ${serialized}`
    }

    let msg = typeof message === 'string' ? message : ''
    if (msg.length > MAX_LOG_CHARS) {
      msg = `${msg.slice(0, MAX_LOG_CHARS)}…`
    }

    const logLevel = level || (type.includes(':') ? type.split(':').pop() : 'info') || 'info'

    switch (logLevel) {
      case 'warn':
        console.warn(`[Plugin:${pluginId}] [WARN] ${msg}${dataStr}`)
        break
      case 'error':
        console.error(`[Plugin:${pluginId}] [ERROR] ${msg}${dataStr}`)
        break
      case 'info':
      default:
        console.log(`[Plugin:${pluginId}] [INFO] ${msg}${dataStr}`)
        break
    }

    return { success: true }
  }
}
