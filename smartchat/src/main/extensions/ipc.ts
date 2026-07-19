import { ipcMain } from 'electron'
import { IExtensionHost } from './host/IExtensionHost'
import { IDedicatedChatSessionManager } from './dedicatedChat/IDedicatedChatSessionManager'
import { IDedicatedChatRepository } from './dedicatedChat/IDedicatedChatRepository'

export function registerExtensionIpcHandlers(
  host: IExtensionHost,
  sessionManager: IDedicatedChatSessionManager,
  chatRepo: IDedicatedChatRepository
) {
  ipcMain.on('extension:chat-send', async (_event, extensionId: string, text: string) => {
    try {
      await sessionManager.routeUserMessage(extensionId, text)
    } catch (err) {
      console.error(`[Extension IPC] Error routing chat message for ${extensionId}:`, err)
    }
  })

  ipcMain.handle('extension:chat-history', async (_event, extensionId: string, limit?: number) => {
    return chatRepo.getHistory(extensionId, limit)
  })

  ipcMain.handle('extension:list', async () => {
    const loadedIds = host.listLoaded()
    return loadedIds.map(id => {
      const manifest = host.getManifest(id)
      return { id, manifest }
    })
  })
}
