import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import electronUpdater, { type AppUpdater } from 'electron-updater'
import { isBoringSslBadDecryptError } from '../runtime-errors'
import type { AppUpdateCheckResult } from '../../shared/types'

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

export async function checkForAppUpdates(): Promise<AppUpdateCheckResult> {
  const currentVersion = app.getVersion()

  if (!shouldCheckForUpdates()) {
    return {
      status: 'unsupported',
      currentVersion,
      message: '当前运行环境暂不支持自动检查更新，请使用已打包的正式版本。'
    }
  }

  const autoUpdater = getAutoUpdater()
  installAutoUpdaterErrorHandler(autoUpdater)

  try {
    const result = await autoUpdater.checkForUpdates()
    const latestVersion = result?.updateInfo.version

    if (!latestVersion || latestVersion === currentVersion) {
      return {
        status: 'not_available',
        currentVersion,
        latestVersion,
        message: '当前已是最新版本。'
      }
    }

    return {
      status: 'available',
      currentVersion,
      latestVersion,
      message: `发现新版本 v${latestVersion}，应用会自动下载并在可安装时提示。`
    }
  } catch (error) {
    logUpdateError(error)
    return {
      status: 'error',
      currentVersion,
      message: error instanceof Error ? error.message : '检查更新失败。'
    }
  }
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
