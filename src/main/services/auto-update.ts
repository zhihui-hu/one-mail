import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import { isBoringSslBadDecryptError } from '../runtime-errors'

const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6

let updateCheckTimer: NodeJS.Timeout | undefined
let autoUpdaterErrorHandlerInstalled = false

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
  installAutoUpdaterErrorHandler(autoUpdater)

  const checkForUpdates = (): void => {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      logUpdateError(error)
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

function installAutoUpdaterErrorHandler(autoUpdater: AppUpdater): void {
  if (autoUpdaterErrorHandlerInstalled) return
  autoUpdaterErrorHandlerInstalled = true

  autoUpdater.on('error', logUpdateError)
}

function logUpdateError(error: unknown): void {
  if (isBoringSslBadDecryptError(error)) {
    console.warn('Ignored BoringSSL BAD_DECRYPT while checking for updates.')
    return
  }

  console.error('Failed to check for updates', error)
}
