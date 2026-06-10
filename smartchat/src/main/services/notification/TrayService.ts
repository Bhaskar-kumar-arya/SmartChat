import { Tray, Menu, app, BrowserWindow, nativeImage } from 'electron'
import icon from '../../../../resources/icon.png?asset'

export class TrayService {
  private tray: Tray | null = null

  constructor(
    private getMainWindow: () => BrowserWindow | null,
    private onQuit?: () => void
  ) {}

  init(): void {
    try {
      let iconPath = icon
      if (typeof iconPath === 'string' && iconPath.includes('app.asar') && !iconPath.includes('app.asar.unpacked')) {
        iconPath = iconPath.replace('app.asar', 'app.asar.unpacked')
      }
      const image = nativeImage.createFromPath(iconPath)
      this.tray = new Tray(image)
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
