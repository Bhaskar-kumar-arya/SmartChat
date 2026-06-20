import { AuthenticationState } from '@whiskeysockets/baileys'
import { WASocket } from './types'

export interface IWASocketFactory {
  fetchVersion(): Promise<[number, number, number]>
  createSocket(
    version: [number, number, number],
    state: AuthenticationState,
    syncFullHistory: boolean,
    shouldSyncHistory: boolean
  ): WASocket
}
