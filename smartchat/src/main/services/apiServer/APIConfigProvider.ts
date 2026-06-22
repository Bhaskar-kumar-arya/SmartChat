import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { IAPIConfigProvider, APIConfig } from './IAPIConfigProvider'

export class APIConfigProvider implements IAPIConfigProvider {
  constructor(private readonly userDataPath: string) {}

  loadOrCreateConfig(): APIConfig {
    const preferencesPath = path.join(this.userDataPath, 'ai_preferences.json')
    let config: Record<string, unknown> = {}

    try {
      if (fs.existsSync(preferencesPath)) {
        const content = fs.readFileSync(preferencesPath, 'utf-8')
        config = JSON.parse(content)
      }
    } catch (err) {
      console.error('[APIConfigProvider] Error reading ai_preferences.json:', err)
    }

    let port = 3003
    const envPort = process.env.SMARTCHAT_API_PORT
    if (envPort) {
      port = parseInt(envPort, 10) || 3003
    } else if (typeof config.externalApiPort === 'number') {
      port = config.externalApiPort
    } else {
      config.externalApiPort = port
    }

    let token = ''
    if (typeof config.externalApiToken === 'string' && config.externalApiToken.trim()) {
      token = config.externalApiToken
    } else {
      token = `smartchat_${crypto.randomBytes(16).toString('hex')}`
      config.externalApiToken = token
      try {
        fs.writeFileSync(preferencesPath, JSON.stringify(config, null, 2), 'utf-8')
        console.log('[APIConfigProvider] Generated and saved new external API token')
      } catch (err) {
        console.error('[APIConfigProvider] Error saving token to ai_preferences.json:', err)
      }
    }

    return { port, token }
  }
}
