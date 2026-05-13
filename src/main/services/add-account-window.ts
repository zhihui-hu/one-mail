import { BrowserWindow, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import appIcon from '../../../resources/icon.png?asset'
import windowsIcon from '../../../resources/icon.ico?asset'

let addAccountWindow: BrowserWindow | null = null

export function openAddAccountWindow(): void {
  if (addAccountWindow && !addAccountWindow.isDestroyed()) {
    addAccountWindow.show()
    addAccountWindow.focus()
    return
  }

  const windowIcon = process.platform === 'win32' ? windowsIcon : appIcon
  const nextWindow = new BrowserWindow({
    width: 440,
    height: 460,
    minWidth: 400,
    minHeight: 420,
    title: '添加账号 - OneMail',
    show: false,
    autoHideMenuBar: true,
    resizable: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 14 },
    ...(process.platform !== 'darwin' ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  addAccountWindow = nextWindow

  nextWindow.on('ready-to-show', () => {
    nextWindow.show()
  })

  nextWindow.on('closed', () => {
    if (addAccountWindow === nextWindow) {
      addAccountWindow = null
    }
  })

  nextWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('window', 'add-account')
    void nextWindow.loadURL(url.toString())
  } else {
    void nextWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: 'add-account' }
    })
  }
}

export function closeAddAccountWindow(): void {
  if (!addAccountWindow || addAccountWindow.isDestroyed()) return
  addAccountWindow.close()
}
