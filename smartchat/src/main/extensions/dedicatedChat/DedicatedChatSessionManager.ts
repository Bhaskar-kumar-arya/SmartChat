import { BrowserWindow } from 'electron'
import { IDedicatedChatRepository } from './IDedicatedChatRepository'
import { IDedicatedChatSessionManager } from './IDedicatedChatSessionManager'
import { IExtensionEventBridge } from '../events/IExtensionEventBridge'

export class DedicatedChatSessionManager implements IDedicatedChatSessionManager {
  constructor(
    private readonly chatRepo: IDedicatedChatRepository,
    private readonly eventBridge: IExtensionEventBridge,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  async routeUserMessage(extensionId: string, text: string): Promise<void> {
    await this.chatRepo.append(extensionId, 'user', JSON.stringify({ type: 'text', text }))
    
    if (text.startsWith('/')) {
      const parts = text.slice(1).split(' ')
      const command = parts[0]
      const args = parts.slice(1).join(' ')
      return this.routeCommand(extensionId, command, args)
    }

    this.eventBridge.emitToExtension(extensionId, 'extension:chat-message', { text })
  }

  async routeButtonPress(extensionId: string, buttonId: string): Promise<void> {
    await this.chatRepo.append(extensionId, 'user', JSON.stringify({ type: 'button', buttonId }))
    // For now we map button presses to text as well, or we could add another event type.
    // The plan specifies 'extension:chat-message' for incoming text.
    this.eventBridge.emitToExtension(extensionId, 'extension:chat-message', { text: `[Button Press] ${buttonId}` })
  }

  async routeCommand(extensionId: string, command: string, args: string): Promise<void> {
    this.eventBridge.emitToExtension(extensionId, 'extension:chat-message', { text: `/${command} ${args}`.trim() })
  }

  pushMessageToRenderer(extensionId: string, message: any): void {
    const win = this.getWindow()
    if (win) {
      win.webContents.send('ipc:extension:chat-push', { extensionId, message })
    }
  }
}
