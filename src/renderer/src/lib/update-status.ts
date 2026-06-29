import type { AppUpdateStatus } from '../../../shared/types'

export const ONEMAIL_HOMEPAGE_URL = 'https://zhihui-hu.github.io/one-mail/'

export function hasAvailableUpdate(status: AppUpdateStatus | null): boolean {
  return (
    status?.state === 'available' ||
    status?.state === 'downloading' ||
    status?.state === 'downloaded'
  )
}
