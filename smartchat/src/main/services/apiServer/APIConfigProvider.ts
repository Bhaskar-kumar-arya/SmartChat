import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { IAPIConfigProvider, APIConfig } from './IAPIConfigProvider'

export class APIConfigProvider implements IAPIConfigProvider {
  constructor(private readonly userDataPath: string) {}

  loadOrCreateConfig(): APIConfig {
    const preferencesPath = path.join(this.userDataPath, 'ai_preferences.json')
    let config: Record<string, unknown> = {}
    // S11-02: a transient read failure / momentarily-corrupt file must NOT lead
    // to writing a 2-key stub back over the user's whole preferences file.
    // Only persist when we know the on-disk state (parsed OK, or genuinely
    // absent).
    let safeToWrite = true

    try {
      if (fs.existsSync(preferencesPath)) {
        const content = fs.readFileSync(preferencesPath, 'utf-8')
        const parsed = JSON.parse(content)
        if (parsed && typeof parsed === 'object') {
          config = parsed as Record<string, unknown>
        } else {
          safeToWrite = false
        }
      }
    } catch (err) {
      console.error('[APIConfigProvider] Error reading ai_preferences.json (will not overwrite it):', err)
      safeToWrite = false
    }

    // P2-S11-10: validate the configured port. An out-of-range / NaN / float
    // value used to flow straight into `server.listen` and either throw (API
    // silently down) or bind an unexpected port.
    const DEFAULT_PORT = 3003
    const isValidPort = (n: unknown): n is number =>
      typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 65535

    let port = DEFAULT_PORT
    const envPort = process.env.SMARTCHAT_API_PORT
    if (envPort) {
      const parsed = parseInt(envPort, 10)
      port = isValidPort(parsed) ? parsed : DEFAULT_PORT
    } else if (config.externalApiPort !== undefined) {
      if (isValidPort(config.externalApiPort)) {
        port = config.externalApiPort
      } else {
        console.warn(
          `[APIConfigProvider] Ignoring invalid externalApiPort (${String(config.externalApiPort)}); using ${DEFAULT_PORT}`
        )
        port = DEFAULT_PORT
        config.externalApiPort = DEFAULT_PORT
      }
    } else {
      config.externalApiPort = port
    }

    let token = ''
    if (typeof config.externalApiToken === 'string' && config.externalApiToken.trim()) {
      token = config.externalApiToken
    } else {
      token = `smartchat_${crypto.randomBytes(16).toString('hex')}`
      config.externalApiToken = token
      if (safeToWrite) {
        try {
          fs.writeFileSync(preferencesPath, JSON.stringify(config, null, 2), 'utf-8')
          console.log('[APIConfigProvider] Generated and saved new external API token')
        } catch (err) {
          console.error('[APIConfigProvider] Error saving token to ai_preferences.json:', err)
        }
      } else {
        console.warn('[APIConfigProvider] Using an in-memory API token this session; ai_preferences.json was unreadable and will not be overwritten')
      }
    }

    return { port, token }
  }
}
