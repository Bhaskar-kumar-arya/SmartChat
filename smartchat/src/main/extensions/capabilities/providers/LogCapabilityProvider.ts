import * as fs from 'fs'
import * as path from 'path'
import { ICapabilityProvider } from '../ICapabilityProvider'
import { ExtensionManifest } from '../../types/ExtensionManifest'
import { IExtensionLogAPI } from '../../context/ExtensionContext'
import { IDocSource, DocSection } from '../../docs/IDocSource'

export class LogCapabilityProvider implements ICapabilityProvider<IExtensionLogAPI>, IDocSource {
  public getDocSection(): DocSection {
    return {
      heading: 'ctx.log',
      permissions: [],
      body: `Logs messages to the extension's isolated log file.
Always available — no permission required.

Log file location (read via Extension Manager → select extension → "View Log"):
  <userData>/extensions/<extensionId>/ext.log

Methods:
  ctx.log.info(msg: string, ...data: any[]): void
  ctx.log.warn(msg: string, ...data: any[]): void
  ctx.log.error(msg: string, ...data: any[]): void

Each call writes a timestamped line:
  [2026-07-20T08:00:00.000Z] [INFO] Your message { optional: 'data' }

Example:
  module.exports = async (ctx) => {
    ctx.log.info('Extension starting', { version: ctx.manifest.version })
    try {
      await doWork()
    } catch (err) {
      ctx.log.error('doWork failed', err.message)
    }
  }`
    }
  }

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
