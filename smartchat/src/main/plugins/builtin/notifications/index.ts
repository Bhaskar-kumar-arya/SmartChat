import { IBuiltinPlugin } from '../../../kernel/plugins/IBuiltinPlugin'
import { PluginManifest } from '../../../kernel/plugins/PluginManifest'
import { PluginContext } from '../../../kernel/plugins/PluginContext'

export class NotificationsPlugin implements IBuiltinPlugin {
  readonly id = 'com.smartchat.builtin.notifications'

  readonly manifest: PluginManifest = {
    id: 'com.smartchat.builtin.notifications',
    name: 'Notification Preferences Plugin',
    version: '1.0.0',
    apiVersion: '2',
    main: 'index.ts',
    permissions: [],
    contributions: {
      settingsPages: [
        { id: 'notifications', title: 'Notifications' }
      ]
    }
  }

  async activate(ctx: PluginContext): Promise<void> {
    ctx.contributions.registerSettingsPage?.('notifications', {
      title: 'Notifications'
    })
  }

  async deactivate(): Promise<void> {
    // Cleanup handled by host
  }
}
