import fs from 'fs'
import { join } from 'path'

export class CommunityLogger {
  private logPath: string

  constructor() {
    // Log directly in the project root for easier access during development
    this.logPath = join(process.cwd(), 'community.log')
    
    // Ensure file exists immediately
    if (!fs.existsSync(this.logPath)) {
      fs.writeFileSync(this.logPath, `--- Community Log Initialized [${new Date().toISOString()}] ---\n`)
    }
  }

  public log(message: string, details?: any) {
    const timestamp = new Date().toISOString()
    let logLine = `[${timestamp}] ${message}`
    if (details) {
      logLine += ` | Details: ${JSON.stringify(details, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      )}`
    }
    logLine += '\n'

    fs.appendFileSync(this.logPath, logLine)
    // Also keep terminal log for visibility but the primary is now the file
    console.log(`[CommunityLog] ${message}`)
  }

  public logTree(tree: any) {
    const timestamp = new Date().toISOString()
    let logLine = `\n--- Community Tree Snapshot [${timestamp}] ---\n`
    logLine += tree
    logLine += '\n-------------------------------------------\n'
    fs.appendFileSync(this.logPath, logLine)
  }

  public getLogPath(): string {
    return this.logPath
  }
}

export const communityLogger = new CommunityLogger()
