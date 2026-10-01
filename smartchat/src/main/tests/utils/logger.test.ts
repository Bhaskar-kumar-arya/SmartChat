import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogger, setLogLevel, getLogLevel } from '../../utils/logger'

describe('logger', () => {
  const original = getLogLevel()
  let spies: Record<'debug' | 'info' | 'warn' | 'error', ReturnType<typeof vi.spyOn>>

  beforeEach(() => {
    spies = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {})
    }
  })
  afterEach(() => {
    setLogLevel(original)
    vi.restoreAllMocks()
  })

  it('prefixes messages with the scope', () => {
    setLogLevel('debug')
    createLogger('sync').info('hello', 1)
    expect(spies.info).toHaveBeenCalledWith('[sync]', 'hello', 1)
  })

  it('filters messages below the current level', () => {
    setLogLevel('warn')
    const log = createLogger('x')
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')
    expect(spies.debug).not.toHaveBeenCalled()
    expect(spies.info).not.toHaveBeenCalled()
    expect(spies.warn).toHaveBeenCalledTimes(1)
    expect(spies.error).toHaveBeenCalledTimes(1)
  })

  it('silent suppresses everything', () => {
    setLogLevel('silent')
    createLogger('x').error('e')
    expect(spies.error).not.toHaveBeenCalled()
  })

  it('child loggers nest scopes', () => {
    setLogLevel('debug')
    createLogger('a').child('b').debug('m')
    expect(spies.debug).toHaveBeenCalledWith('[a:b]', 'm')
  })
})
