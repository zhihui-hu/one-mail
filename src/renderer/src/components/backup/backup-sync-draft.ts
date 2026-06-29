import type { BackupSyncProvider, BackupSyncSettings } from '../../../../shared/types'

export function createBackupSyncDraft(
  provider: BackupSyncProvider,
  current?: BackupSyncSettings | null
): BackupSyncSettings {
  if (provider === 'webdav') {
    return current?.provider === 'webdav'
      ? { ...current }
      : { provider: 'webdav', remoteUrl: '', username: '' }
  }

  if (provider === 's3') {
    return current?.provider === 's3'
      ? { ...current }
      : {
          provider: 's3',
          endpoint: '',
          region: 'us-east-1',
          bucket: '',
          key: 'onemail-backup.sql',
          accessKeyId: ''
        }
  }

  return { provider: 'none' }
}

export function getBackupSyncSettingsKey(settings: BackupSyncSettings | null): string {
  if (!settings) return 'backup-sync-loading'
  if (settings.provider === 'webdav') {
    return `webdav:${settings.remoteUrl}:${settings.username ?? ''}:${settings.passwordConfigured ? '1' : '0'}`
  }
  if (settings.provider === 's3') {
    return `s3:${settings.endpoint ?? ''}:${settings.region}:${settings.bucket}:${settings.key}:${settings.accessKeyId}:${settings.secretAccessKeyConfigured ? '1' : '0'}`
  }
  return 'none'
}
