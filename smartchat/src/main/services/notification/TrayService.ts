import { Tray, Menu, app, BrowserWindow } from 'electron'
import icon from '../../../../resources/icon.png?asset'

export class TrayService {
  private tray: Tray | null = null

  constructor(
    private getMainWindow: () => BrowserWindow | null,
    private onQuit?: () => void
  ) {}

  init(): void {
    try {
      this.tray = new Tray(icon)
      this.tray.setToolTip('SmartChat')

      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Open SmartChat',
          click: () => {
            this.restoreWindow()
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            if (this.onQuit) {
              this.onQuit()
            } else {
              app.quit()
            }
          }
        }
      ])

      this.tray.setContextMenu(contextMenu)

      this.tray.on('double-click', () => {
        this.restoreWindow()
      })
    } catch (err) {
      console.error('Failed to initialize System Tray:', err)
    }
  }

  private restoreWindow(): void {
    const win = this.getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }
}
