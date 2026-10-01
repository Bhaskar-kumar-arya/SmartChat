/**
 * Tiny scoped, leveled logger. Dependency-free so it can be imported from main, workers or (by
 * relative path) the renderer.
 *
 *   const log = createLogger('whatsapp:sync')
 *   log.info('batch done', { count })
 *
 * Level resolves from the SMARTCHAT_LOG_LEVEL env var (debug|info|warn|error|silent), default 'info'
 * ('warn' under NODE_ENV=test). Override at runtime with setLogLevel().
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }

function isLevel(v: unknown): v is LogLevel {
  return typeof v === 'string' && v in ORDER
}

function defaultLevel(): LogLevel {
  const env = typeof process !== 'undefined' ? process.env : undefined
  const fromEnv = env?.SMARTCHAT_LOG_LEVEL?.toLowerCase()
  if (isLevel(fromEnv)) return fromEnv
  return env?.NODE_ENV === 'test' ? 'warn' : 'info'
}

let currentLevel: LogLevel = defaultLevel()

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

export interface Logger {
  readonly scope: string
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  /** A child logger whose scope is `parent:child`. */
  child: (name: string) => Logger
}

export function createLogger(scope: string): Logger {
  const emit =
    (level: Exclude<LogLevel, 'silent'>) =>
    (...args: unknown[]): void => {
      if (ORDER[level] < ORDER[currentLevel]) return
      // Resolve the console method at call time so spies/mocks work.
      console[level](`[${scope}]`, ...args)
    }
  return {
    scope,
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child: (name) => createLogger(`${scope}:${name}`)
  }
}
