import { IExtensionSchedulerService } from './IExtensionSchedulerService'
import cron from 'node-cron'

export class ExtensionSchedulerService implements IExtensionSchedulerService {
  // Map of extensionId to an array of cancellation functions
  private handles = new Map<string, Array<() => void>>()

  private addHandle(extensionId: string, cancelFn: () => void) {
    if (!this.handles.has(extensionId)) {
      this.handles.set(extensionId, [])
    }
    this.handles.get(extensionId)!.push(cancelFn)
  }

  setInterval(extensionId: string, ms: number, fn: () => void | Promise<void>): () => void {
    const timer = setInterval(async () => {
      try {
        await fn()
      } catch (e) {
        console.error(`[ExtensionSchedulerService] Error in interval for extension ${extensionId}:`, e)
      }
    }, ms)

    let isCancelled = false
    const cancelFn = () => {
      if (isCancelled) return
      clearInterval(timer)
      isCancelled = true
    }
    
    this.addHandle(extensionId, cancelFn)
    return cancelFn
  }

  setTimeout(extensionId: string, ms: number, fn: () => void | Promise<void>): () => void {
    const timer = setTimeout(async () => {
      try {
        await fn()
      } catch (e) {
        console.error(`[ExtensionSchedulerService] Error in timeout for extension ${extensionId}:`, e)
      }
    }, ms)

    let isCancelled = false
    const cancelFn = () => {
      if (isCancelled) return
      clearTimeout(timer)
      isCancelled = true
    }

    this.addHandle(extensionId, cancelFn)
    return cancelFn
  }

  registerCron(extensionId: string, name: string, expr: string, fn: () => void | Promise<void>): void {
    const task = cron.schedule(expr, async () => {
      try {
        await fn()
      } catch (e) {
        console.error(`[ExtensionSchedulerService] Error in cron '${name}' for extension ${extensionId}:`, e)
      }
    })

    let isCancelled = false
    const cancelFn = () => {
      if (isCancelled) return
      task.stop()
      isCancelled = true
    }

    this.addHandle(extensionId, cancelFn)
  }

  cancelAll(extensionId: string): void {
    const fns = this.handles.get(extensionId)
    if (fns) {
      for (const cancelFn of fns) {
        cancelFn()
      }
      this.handles.delete(extensionId)
    }
  }
}
