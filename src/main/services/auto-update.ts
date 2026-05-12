import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import electronUpdater, { type AppUpdater } from 'electron-updater'

const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6

let updateCheckTimer: NodeJS.Timeout | undefined

function getAutoUpdater(): AppUpdater {
  const { autoUpdater } = electronUpdater
  return autoUpdater
}

function shouldCheckForUpdates(): boolean {
  return app.isPackaged && !is.dev
}

export function startAutoUpdateChecks(): void {
  if (!shouldCheckForUpdates() || updateCheckTimer) {
    return
  }

  const autoUpdater = getAutoUpdater()

  const checkForUpdates = (): void => {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      console.error('Failed to check for updates', error)
    })
  }

  checkForUpdates()
  updateCheckTimer = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS)
}

export function stopAutoUpdateChecks(): void {
  if (!updateCheckTimer) {
    return
  }

  clearInterval(updateCheckTimer)
  updateCheckTimer = undefined
}
