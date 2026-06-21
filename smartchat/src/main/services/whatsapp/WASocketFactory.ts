import makeWASocketImport, { fetchLatestBaileysVersion, Browsers, AuthenticationState } from '@whiskeysockets/baileys'
import NodeCache from 'node-cache'
import { WASocket } from './types'
import { IWASocketFactory } from './IWASocketFactory'
import { IMessageReadRepository } from '../messages/IMessageQueryRepository'

const makeWASocket = (typeof makeWASocketImport === 'function'
  ? makeWASocketImport
  : (makeWASocketImport as unknown as { default: typeof makeWASocketImport }).default) as typeof makeWASocketImport

export class WASocketFactory implements IWASocketFactory {
  constructor(
    private readonly messageQueryRepository: IMessageReadRepository
  ) {}

  public async fetchVersion(): Promise<[number, number, number]> {
    console.log('[Connection] Fetching latest WhatsApp version from Baileys...')
    const latest = await fetchLatestBaileysVersion()
    return latest.version as [number, number, number]
  }

  public createSocket(
    version: [number, number, number],
    state: AuthenticationState,
    syncFullHistory: boolean,
    shouldSyncHistory: boolean
  ): WASocket {
    const groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false })

    return makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      generateHighQualityLinkPreview: true,
      browser: Browsers.macOS('Desktop'),
      syncFullHistory,
      shouldSyncHistoryMessage: () => shouldSyncHistory,
      cachedGroupMetadata: async (jid) => groupCache.get(jid) ?? undefined,
      getMessage: async (key) => {
        if (!key.id) return undefined
        try {
          const msg = await this.messageQueryRepository.findMessageById(key.id)
          if (msg && msg.content) {
            return JSON.parse(msg.content)
          }
        } catch (err) {
          console.error('Error fetching message for retry/reaction:', err)
        }
        return undefined
      }
    })
  }
}
