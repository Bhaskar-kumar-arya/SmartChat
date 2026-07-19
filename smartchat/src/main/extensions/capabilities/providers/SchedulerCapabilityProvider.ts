import { ICapabilityProvider } from '../ICapabilityProvider'
import { IExtensionSchedulerAPI } from '../../context/ExtensionContext'
import { ExtensionManifest } from '../../types/ExtensionManifest'
import { IExtensionSchedulerService } from '../../scheduler/IExtensionSchedulerService'

export class SchedulerCapabilityProvider implements ICapabilityProvider<IExtensionSchedulerAPI> {
  readonly permissions = ['scheduler']

  constructor(private schedulerService: IExtensionSchedulerService) {}

  build(manifest: ExtensionManifest, extensionId: string): IExtensionSchedulerAPI | undefined {
    if (!manifest.permissions.includes('scheduler')) {
      return undefined
    }

    return {
      setInterval: (ms: number, fn: () => void | Promise<void>) => {
        return this.schedulerService.setInterval(extensionId, ms, fn)
      },
      setTimeout: (ms: number, fn: () => void | Promise<void>) => {
        return this.schedulerService.setTimeout(extensionId, ms, fn)
      },
      onCron: (name: string, fn: () => void | Promise<void>) => {
        // Read the cron expression from the manifest
        const cronEntry = manifest.scheduler?.intervals?.find(i => i.name === name)
        if (!cronEntry) {
          throw new Error(`Cron entry '${name}' not defined in manifest scheduler.intervals`)
        }
        this.schedulerService.registerCron(extensionId, name, cronEntry.cron, fn)
      }
    }
  }
}
