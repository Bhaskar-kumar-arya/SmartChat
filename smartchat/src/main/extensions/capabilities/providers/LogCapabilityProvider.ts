import * as fs from 'fs'
import * as path from 'path'
import { ICapabilityProvider } from '../ICapabilityProvider'
import { ExtensionManifest } from '../../types/ExtensionManifest'
import { IExtensionLogAPI } from '../../context/ExtensionContext'

export class LogCapabilityProvider implements ICapabilityProvider<IExtensionLogAPI> {
  readonly permissions: string[] = [] // Always available

  constructor(private extensionsPath: string) {}

  build(_manifest: ExtensionManifest, extensionId: string): IExtensionLogAPI {
    const extensionDir = path.join(this.extensionsPath, extensionId)
    if (!fs.existsSync(extensionDir)) {
      fs.mkdirSync(extensionDir, { recursive: true })
    }
    const logFilePath = path.join(extensionDir, 'ext.log')

    const appendLog = (level: string, msg: string, data: any[]) => {
      const timestamp = new Date().toISOString()
      const dataStr = data.length > 0 ? ' ' + data.map(d => typeof d === 'object' ? JSON.stringify(d) : String(d)).join(' ') : ''
      const logLine = `[${timestamp}] [${level.toUpperCase()}] ${msg}${dataStr}\n`
      try {
        fs.appendFileSync(logFilePath, logLine)
      } catch (e) {
        console.error(`Failed to write to extension log ${logFilePath}:`, e)
      }
    }

    return {
      info: (msg: string, ...data: any[]) => appendLog('info', msg, data),
      warn: (msg: string, ...data: any[]) => appendLog('warn', msg, data),
      error: (msg: string, ...data: any[]) => appendLog('error', msg, data),
    }
  }
}
