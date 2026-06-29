import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  Tray,
  type MenuItemConstructorOptions,
  type NativeImage
} from 'electron'

type TrayActions = {
  showWindow: () => BrowserWindow
  syncNow: () => Promise<void> | void
}

type TrayLabels = {
  open: string
  sync: string
  syncing: string
  quit: string
}

let tray: Tray | null = null
let trayActions: TrayActions | null = null
let syncing = false
let quitRequested = false

export function initializeTray(iconPath: string, actions: TrayActions): void {
  if (tray) return

  trayActions = actions
  tray = new Tray(createTrayIcon(iconPath))
  tray.setToolTip('OneMail')

  if (process.platform !== 'darwin') {
    tray.on('click', () => {
      actions.showWindow()
    })
  }

  updateTrayMenu()
}

export function shouldHideWindowToTray(): boolean {
  return !quitRequested && process.platform !== 'darwin' && tray !== null
}

export function requestQuitFromTray(): void {
  quitRequested = true
  app.quit()
}

export function markAppQuitRequested(): void {
  quitRequested = true
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
  trayActions = null
  syncing = false
}

function updateTrayMenu(): void {
  if (!tray || !trayActions) return

  tray.setContextMenu(createTrayMenu(trayActions))
}

function createTrayMenu(actions: TrayActions): Electron.Menu {
  const labels = getTrayLabels()
  const template: MenuItemConstructorOptions[] = [
    {
      label: labels.open,
      click: () => {
        actions.showWindow()
      }
    },
    {
      label: syncing ? labels.syncing : labels.sync,
      enabled: !syncing,
      click: () => {
        runTraySync(actions)
      }
    },
    { type: 'separator' },
    {
      label: labels.quit,
      click: () => {
        requestQuitFromTray()
      }
    }
  ]

  return Menu.buildFromTemplate(template)
}

function runTraySync(actions: TrayActions): void {
  if (syncing) return

  syncing = true
  updateTrayMenu()

  void Promise.resolve()
    .then(() => actions.syncNow())
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[tray] manual sync failed: ${message}`)
    })
    .finally(() => {
      syncing = false
      updateTrayMenu()
    })
}

function getTrayLabels(): TrayLabels {
  const isChinese = app.getLocale().toLowerCase().startsWith('zh')

  return isChinese
    ? {
        open: '打开 OneMail',
        sync: '同步邮件',
        syncing: '正在同步…',
        quit: '退出 OneMail'
      }
    : {
        open: 'Open OneMail',
        sync: 'Sync Mail',
        syncing: 'Syncing…',
        quit: 'Quit OneMail'
      }
}

function createTrayIcon(iconPath: string): string | NativeImage {
  if (process.platform !== 'darwin') return iconPath

  const source = nativeImage.createFromPath(iconPath)
  if (source.isEmpty()) return iconPath

  // macOS status-bar icons are monochrome template images. Extract the white
  // envelope from the app icon and discard its blue rounded-square background.
  const size = 36
  const resized = source.resize({ width: size, height: size, quality: 'best' })
  const bitmap = Buffer.from(resized.toBitmap())

  for (let offset = 0; offset < bitmap.length; offset += 4) {
    const blue = bitmap[offset]
    const green = bitmap[offset + 1]
    const red = bitmap[offset + 2]
    const sourceAlpha = bitmap[offset + 3]
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
    const envelopeCoverage = Math.max(0, Math.min(1, (luminance - 175) / 55))

    bitmap[offset] = 0
    bitmap[offset + 1] = 0
    bitmap[offset + 2] = 0
    bitmap[offset + 3] = Math.round(sourceAlpha * envelopeCoverage)
  }

  const templateIcon = nativeImage.createFromBitmap(bitmap, {
    width: size,
    height: size,
    scaleFactor: 2
  })
  templateIcon.setTemplateImage(true)
  return templateIcon
}
