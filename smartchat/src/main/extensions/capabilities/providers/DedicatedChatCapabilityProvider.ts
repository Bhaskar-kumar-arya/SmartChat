import { ICapabilityProvider } from '../ICapabilityProvider'
import { ExtensionManifest } from '../../types/ExtensionManifest'
import { IExtensionDedicatedChatAPI, DedicatedChatContent } from '../../context/ExtensionContext'
import { IDedicatedChatRepository } from '../../dedicatedChat/IDedicatedChatRepository'
import { BrowserWindow } from 'electron'
import { IDocSource, DocSection } from '../../docs/IDocSource'

import { GENERATED_INTERFACES } from '../../docs/generatedDocs'

export class DedicatedChatCapabilityProvider implements ICapabilityProvider<IExtensionDedicatedChatAPI>, IDocSource {
  public getDocSection(): DocSection {
    let body = `Interact with the extension's dedicated sidebar chat.\n\n`
    if (GENERATED_INTERFACES['IExtensionDedicatedChatAPI']) {
      body += `API:\n${GENERATED_INTERFACES['IExtensionDedicatedChatAPI']}\n\n`
    }
    if (GENERATED_INTERFACES['DedicatedChatContent']) {
      body += `Content Shape:\n${GENERATED_INTERFACES['DedicatedChatContent']}\n\n`
    }
    if (GENERATED_INTERFACES['DedicatedChatMessage']) {
      body += `Message Shape:\n${GENERATED_INTERFACES['DedicatedChatMessage']}\n\n`
    }

    body += `Handling Interactive Button Callbacks:
------------------------------------------
When sending cards with action buttons (using the 'buttons' array inside a card payload), clicking a button triggers a callback message sent to the extension:

1. The button click event is delivered via the 'extension:chat-message' event (which requires the 'events:dedicated_chat' permission).
2. The payload of the event will have its 'text' property set to the button's ID prefixed with '__button:' (e.g. '__button:check_status').
3. In your extension's event listener, detect this prefix to execute the button's associated logic.

Example:
\`\`\`javascript
ctx.events.on('extension:chat-message', async (msg) => {
  if (msg.text.startsWith('__button:')) {
    const buttonId = msg.text.substring('__button:'.length);
    if (buttonId === 'check_status') {
      await ctx.dedicatedChat.send({
        type: 'text',
        text: 'All systems operational!'
      });
    }
  }
});
\`\`\`
`

    return {
      heading: 'ctx.dedicatedChat',
      permissions: ['ui:dedicated_chat'],
      body: body.trim()
    }
  }

  readonly permissions = ['ui:dedicated_chat']

  constructor(
    private readonly chatRepo: IDedicatedChatRepository,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  build(manifest: ExtensionManifest): IExtensionDedicatedChatAPI | undefined {
    if (!manifest.permissions.includes('ui:dedicated_chat')) {
      return undefined
    }

    const extensionId = manifest.id

    return {
      send: async (content: DedicatedChatContent): Promise<void> => {
        const payload = JSON.stringify(content)
        await this.chatRepo.append(extensionId, 'extension', payload)
        
        const win = this.getWindow()
        if (win) {
          win.webContents.send('extension:chat-push', { 
            extensionId, 
            message: {
              id: Date.now().toString(),
              extensionId,
              role: 'extension',
              content: payload,
              createdAt: new Date()
            } 
          })
        }
      },
      getHistory: async (limit?: number) => {
        return this.chatRepo.getHistory(extensionId, limit)
      },
      clearHistory: async () => {
        await this.chatRepo.clear(extensionId)
      },
      focus: () => {
        const win = this.getWindow()
        if (win) {
          win.webContents.send('extension:chat-focus', { extensionId })
        }
      }
    }
  }
}
