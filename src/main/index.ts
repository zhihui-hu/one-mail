import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import appIcon from '../../resources/icon.png?asset'
import windowsIcon from '../../resources/icon.ico?asset'
import { closeDatabase, initializeDatabase } from './db/connection'
import { registerIpcHandlers } from './ipc'
import { installRuntimeErrorGuards } from './runtime-errors'
import { startAutoUpdateChecks, stopAutoUpdateChecks } from './services/auto-update'
import {
  requestForegroundMailboxSync,
  startMailboxWatchers,
  stopMailboxWatchers
} from './services/mailbox-watch'
import { setNotificationOpenWindowHandler } from './services/notification-center'

installRuntimeErrorGuards()

let mainWindow: BrowserWindow | null = null

function createWindow(initialRoute = '/'): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }

  const windowIcon = process.platform === 'win32' ? windowsIcon : appIcon

  // Create the browser window.
  const nextWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'OneMail',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 14 },
    ...(process.platform !== 'darwin' ? { icon: windowIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow = nextWindow

  nextWindow.on('ready-to-show', () => {
    nextWindow.show()
    requestForegroundMailboxSync('startup')
  })

  nextWindow.on('focus', () => {
    requestForegroundMailboxSync('focus')
  })

  nextWindow.on('show', () => {
    requestForegroundMailboxSync('show')
  })

  nextWindow.on('restore', () => {
    requestForegroundMailboxSync('restore')
  })

  nextWindow.on('closed', () => {
    if (mainWindow === nextWindow) mainWindow = null
  })

  nextWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.hash = initialRoute
    void nextWindow.loadURL(url.toString())
  } else {
    void nextWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: initialRoute
    })
  }

  return nextWindow
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.huzhihui.onemail')
  if (process.platform === 'darwin') {
    app.dock?.setIcon(appIcon)
  }
  initializeDatabase()
  registerIpcHandlers()
  startMailboxWatchers()
  startAutoUpdateChecks()
  setNotificationOpenWindowHandler((route) => createWindow(route))

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopAutoUpdateChecks()
  stopMailboxWatchers()
  closeDatabase()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
