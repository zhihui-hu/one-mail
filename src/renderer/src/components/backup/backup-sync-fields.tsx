import * as React from 'react'

import { Field, FieldLabel } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { createBackupSyncDraft } from '@renderer/components/backup/backup-sync-draft'
import { useI18n } from '@renderer/lib/i18n'
import type { BackupSyncProvider, BackupSyncSettings } from '../../../../shared/types'

type BackupSyncFieldsProps = {
  draft: BackupSyncSettings
  currentSettings?: BackupSyncSettings | null
  disabled?: boolean
  idPrefix?: string
  showProvider?: boolean
  onChange: (nextDraft: BackupSyncSettings) => void
}

export function BackupSyncFields({
  draft,
  currentSettings,
  disabled,
  idPrefix = 'backup-sync',
  showProvider = true,
  onChange
}: BackupSyncFieldsProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div className="grid gap-2">
      {showProvider ? (
        <Field>
          <FieldLabel className="text-xs" htmlFor={`${idPrefix}-provider`}>
            {t('settings.backup.remoteProvider')}
          </FieldLabel>
          <Select
            value={draft.provider}
            disabled={disabled}
            onValueChange={(value) =>
              onChange(createBackupSyncDraft(value as BackupSyncProvider, currentSettings))
            }
          >
            <SelectTrigger id={`${idPrefix}-provider`} size="sm">
              <SelectValue placeholder={t('settings.backup.remoteProvider')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="none">{t('settings.backup.remoteProviderNone')}</SelectItem>
                <SelectItem value="webdav">WebDAV</SelectItem>
                <SelectItem value="s3">S3</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {draft.provider === 'webdav' ? (
        <div className="grid gap-2">
          <BackupTextField
            id={`${idPrefix}-webdav-url`}
            label={t('settings.backup.webdavUrl')}
            value={draft.remoteUrl}
            placeholder="https://dav.example.com/onemail-backup.sql"
            disabled={disabled}
            onChange={(value) => onChange({ ...draft, remoteUrl: value })}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <BackupTextField
              id={`${idPrefix}-webdav-username`}
              label={t('settings.backup.username')}
              value={draft.username ?? ''}
              disabled={disabled}
              onChange={(value) => onChange({ ...draft, username: value })}
            />
            <BackupTextField
              id={`${idPrefix}-webdav-password`}
              label={t('settings.backup.password')}
              value={draft.password ?? ''}
              type="password"
              placeholder={
                draft.passwordConfigured ? t('settings.backup.secretKeepPlaceholder') : ''
              }
              disabled={disabled}
              onChange={(value) => onChange({ ...draft, password: value })}
            />
          </div>
        </div>
      ) : null}

      {draft.provider === 's3' ? (
        <div className="grid gap-2">
          <BackupTextField
            id={`${idPrefix}-s3-endpoint`}
            label={t('settings.backup.s3Endpoint')}
            value={draft.endpoint ?? ''}
            placeholder="https://account-id.r2.cloudflarestorage.com"
            disabled={disabled}
            onChange={(value) => onChange({ ...draft, endpoint: value })}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <BackupTextField
              id={`${idPrefix}-s3-region`}
              label={t('settings.backup.s3Region')}
              value={draft.region}
              placeholder="us-east-1"
              disabled={disabled}
              onChange={(value) => onChange({ ...draft, region: value })}
            />
            <BackupTextField
              id={`${idPrefix}-s3-bucket`}
              label={t('settings.backup.s3Bucket')}
              value={draft.bucket}
              disabled={disabled}
              onChange={(value) => onChange({ ...draft, bucket: value })}
            />
          </div>
          <BackupTextField
            id={`${idPrefix}-s3-key`}
            label={t('settings.backup.s3Key')}
            value={draft.key}
            placeholder="onemail/onemail-backup.sql"
            disabled={disabled}
            onChange={(value) => onChange({ ...draft, key: value })}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <BackupTextField
              id={`${idPrefix}-s3-access-key`}
              label={t('settings.backup.s3AccessKey')}
              value={draft.accessKeyId}
              disabled={disabled}
              onChange={(value) => onChange({ ...draft, accessKeyId: value })}
            />
            <BackupTextField
              id={`${idPrefix}-s3-secret-key`}
              label={t('settings.backup.s3SecretKey')}
              value={draft.secretAccessKey ?? ''}
              type="password"
              placeholder={
                draft.secretAccessKeyConfigured ? t('settings.backup.secretKeepPlaceholder') : ''
              }
              disabled={disabled}
              onChange={(value) => onChange({ ...draft, secretAccessKey: value })}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

function BackupTextField({
  id,
  label,
  value,
  placeholder,
  type = 'text',
  disabled,
  onChange
}: {
  id: string
  label: string
  value: string
  placeholder?: string
  type?: React.HTMLInputTypeAttribute
  disabled?: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <Field>
      <FieldLabel className="text-xs" htmlFor={id}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}
