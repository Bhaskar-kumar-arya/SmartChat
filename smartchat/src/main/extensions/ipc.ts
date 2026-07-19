import { ipcMain } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { IExtensionHost } from './host/IExtensionHost'
import { IExtensionLoader } from './host/IExtensionLoader'
import { IDedicatedChatSessionManager } from './dedicatedChat/IDedicatedChatSessionManager'
import { IDedicatedChatRepository } from './dedicatedChat/IDedicatedChatRepository'

export function registerExtensionIpcHandlers(
  host: IExtensionHost,
  sessionManager: IDedicatedChatSessionManager,
  chatRepo: IDedicatedChatRepository,
  loader?: IExtensionLoader,
  extensionsDir?: string,
  storageRepo?: any
) {
  // ── Existing Phase 8 handlers ────────────────────────────────────────
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
    if (!loader) return []
    const installed = await loader.listInstalled()
    const loadedIds = host.listLoaded()
    return installed.map(manifest => ({
      id: manifest.id,
      manifest,
      isLoaded: loadedIds.includes(manifest.id)
    }))
  })

  // ── New Phase 9 handlers ─────────────────────────────────────────────
  ipcMain.handle('extension:install', async (_event, scextPath: string) => {
    if (!loader) throw new Error('ExtensionLoader not available')
    const manifest = await loader.install(scextPath)
    await host.load(manifest.id)
    return manifest
  })

  ipcMain.handle('extension:unload', async (_event, id: string) => {
    return host.unload(id)
  })

  ipcMain.handle('extension:uninstall', async (_event, id: string) => {
    if (!loader) return
    await host.unload(id).catch(() => {})
    await loader.uninstall(id)
    await chatRepo.clear(id).catch(() => {})
    if (storageRepo && storageRepo.clear) {
      await storageRepo.clear(id).catch(() => {})
    }
  })

  ipcMain.handle('extension:reload', async (_event, id: string) => {
    return host.reload(id)
  })

  ipcMain.handle('extension:get-log', async (_event, id: string) => {
    if (!extensionsDir) return ''
    const logPath = path.join(extensionsDir, id, 'ext.log')
    return fs.readFile(logPath, 'utf8').catch(() => '')
  })
}
