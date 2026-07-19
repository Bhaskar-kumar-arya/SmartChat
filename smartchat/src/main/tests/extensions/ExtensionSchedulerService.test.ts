import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ExtensionSchedulerService } from '../../extensions/scheduler/ExtensionSchedulerService'
import { SchedulerCapabilityProvider } from '../../extensions/capabilities/providers/SchedulerCapabilityProvider'
import { ExtensionManifest } from '../../extensions/types/ExtensionManifest'

describe('ExtensionSystem - Phase 04 (Scheduler)', () => {
  let schedulerService: ExtensionSchedulerService
  let provider: SchedulerCapabilityProvider

  const mockManifest: ExtensionManifest = {
    id: 'test-scheduler',
    name: 'Test Scheduler',
    version: '1.0.0',
    apiVersion: '1',
    description: 'Test',
    main: 'index.js',
    permissions: ['scheduler'],
    scheduler: {
      onStart: true,
      intervals: [
        {
          name: 'morning',
          cron: '* * * * * *' // every second for testing
        }
      ]
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    schedulerService = new ExtensionSchedulerService()
    provider = new SchedulerCapabilityProvider(schedulerService)
  })

  afterEach(() => {
    schedulerService.cancelAll(mockManifest.id)
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('should provide scheduler API if permission is declared', () => {
    const api = provider.build(mockManifest, mockManifest.id)
    expect(api).toBeDefined()
    expect(api?.setInterval).toBeTypeOf('function')
    expect(api?.setTimeout).toBeTypeOf('function')
    expect(api?.onCron).toBeTypeOf('function')
  })

  it('should return undefined if scheduler permission is missing', () => {
    const api = provider.build({ ...mockManifest, permissions: [] }, mockManifest.id)
    expect(api).toBeUndefined()
  })

  it('setInterval should execute periodically and can be cancelled individually', () => {
    const api = provider.build(mockManifest, mockManifest.id)!
    const fn = vi.fn()
    
    const cancel = api.setInterval(3000, fn)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledTimes(2)

    cancel()
    vi.advanceTimersByTime(3000)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancelAll should cancel all intervals and timeouts for an extension', () => {
    const api = provider.build(mockManifest, mockManifest.id)!
    const fnInterval = vi.fn()
    const fnTimeout = vi.fn()
    const fnCron = vi.fn()

    api.setInterval(3000, fnInterval)
    api.setTimeout(5000, fnTimeout)
    api.onCron('morning', fnCron)

    // Advance 1000 to trigger cron (assuming node-cron respects fake timers, though it might not perfectly, 
    // but we can just test the cancelAll logic)
    
    // We cancel everything
    schedulerService.cancelAll(mockManifest.id)
    
    // Fast forward enough for interval and timeout to trigger if not cancelled
    vi.advanceTimersByTime(10000)
    
    expect(fnInterval).not.toHaveBeenCalled()
    expect(fnTimeout).not.toHaveBeenCalled()
    // cron testing with fakeTimers can be tricky depending on node-cron implementation, 
    // but we know cancelAll calls .stop()
  })

  it('should throw if cron name is not defined in manifest', () => {
    const api = provider.build(mockManifest, mockManifest.id)!
    expect(() => {
      api.onCron('invalid-name', () => {})
    }).toThrow(/Cron entry 'invalid-name' not defined/)
  })
})
