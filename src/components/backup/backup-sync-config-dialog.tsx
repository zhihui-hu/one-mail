import { CheckCircle2, Cloud, Save, Server, Trash2, X } from 'lucide-react'
import * as React from 'react'

import { createBackupSyncDraft } from '@renderer/components/backup/backup-sync-draft'
import { BackupSyncFields } from '@renderer/components/backup/backup-sync-fields'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { SweepShine } from '@renderer/components/sweep-shine'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { FieldError } from '@renderer/components/ui/field'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { useI18n } from '@renderer/lib/i18n'
import type { BackupSyncProvider, BackupSyncSettings } from '@renderer/shared/types'

type BackupSyncConfigDialogProps = {
  open: boolean
  currentSettings: BackupSyncSettings | null
  saving: boolean
  testing: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSave: (input: BackupSyncSettings) => Promise<boolean>
  onTest: (input: BackupSyncSettings) => Promise<boolean>
}

export function BackupSyncConfigDialog({
  open,
  currentSettings,
  saving,
  testing,
  error,
  onOpenChange,
  onSave,
  onTest
}: BackupSyncConfigDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const [draft, setDraft] = React.useState<BackupSyncSettings>(() =>
    getInitialDraft(currentSettings)
  )
  const [tested, setTested] = React.useState(false)
  const [submitted, setSubmitted] = React.useState(false)
  const busy = saving || testing

  React.useEffect(() => {
    if (!open) return
    setDraft(getInitialDraft(currentSettings))
    setTested(false)
    setSubmitted(false)
  }, [currentSettings, open])

  function selectProvider(provider: BackupSyncProvider): void {
    if (provider === 'none') return
    setDraft(createBackupSyncDraft(provider, currentSettings))
    setTested(false)
    setSubmitted(false)
  }

  async function handleTest(): Promise<void> {
    setTested(false)
    setSubmitted(true)
    const succeeded = await onTest(draft)
    setTested(succeeded)
  }

  async function handleSave(input: BackupSyncSettings): Promise<void> {
    setTested(false)
    setSubmitted(true)
    const succeeded = await onSave(input)
    if (succeeded) onOpenChange(false)
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen)
      }}
      title={
        currentSettings?.provider && currentSettings.provider !== 'none'
          ? t('settings.backup.remoteEditTitle')
          : t('settings.backup.remoteAddTitle')
      }
      description={t('settings.backup.remoteConfigDescription')}
      contentClassName="grid max-h-[88dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-lg p-0 sm:max-w-lg"
      headerClassName="border-b px-4 py-3 pr-12 [&_[data-slot=dialog-title]]:text-sm! [&_[data-slot=drawer-title]]:text-sm! [&_[data-slot=dialog-description]]:text-xs [&_[data-slot=drawer-description]]:text-xs"
      bodyClassName="min-h-0 overflow-auto px-4 py-3"
      footerClassName="border-t px-4 py-3"
      footer={
        <div className="flex w-full items-center gap-2">
          {currentSettings?.provider && currentSettings.provider !== 'none' ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void handleSave({ provider: 'none' })}
            >
              <Trash2 data-icon="inline-start" />
              {t('settings.backup.remoteDisable')}
            </Button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
              <X data-icon="inline-start" />
              {t('common.cancel')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || draft.provider === 'none'}
              onClick={() => void handleTest()}
            >
              <Cloud data-icon="inline-start" />
              {testing ? (
                <SweepShine>{t('settings.backup.remoteTesting')}</SweepShine>
              ) : (
                t('settings.backup.remoteTest')
              )}
            </Button>
            <Button
              size="sm"
              disabled={busy || draft.provider === 'none'}
              onClick={() => void handleSave(draft)}
            >
              <Save data-icon="inline-start" />
              {saving ? (
                <SweepShine>{t('settings.backup.remoteSaving')}</SweepShine>
              ) : (
                t('common.save')
              )}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3">
        <ToggleGroup
          type="single"
          value={draft.provider}
          onValueChange={(value) => {
            if (value) selectProvider(value as BackupSyncProvider)
          }}
          className="grid w-full grid-cols-2 gap-1 rounded-lg bg-muted p-1"
        >
          <ToggleGroupItem value="webdav" variant="ghost" size="sm" className="w-full">
            <Server aria-hidden="true" />
            WebDAV
          </ToggleGroupItem>
          <ToggleGroupItem value="s3" variant="ghost" size="sm" className="w-full">
            <Cloud aria-hidden="true" />
            S3
          </ToggleGroupItem>
        </ToggleGroup>

        <BackupSyncFields
          draft={draft}
          currentSettings={currentSettings}
          disabled={busy}
          idPrefix="backup-sync-config"
          showProvider={false}
          onChange={(nextDraft) => {
            setDraft(nextDraft)
            setTested(false)
            setSubmitted(false)
          }}
        />

        {tested ? (
          <Alert className="border-emerald-500/30 bg-emerald-500/8 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 />
            <AlertDescription>{t('settings.backup.remoteTested')}</AlertDescription>
          </Alert>
        ) : null}
        {submitted && error ? <FieldError className="text-xs">{error}</FieldError> : null}
      </div>
    </ResponsiveDialog>
  )
}

function getInitialDraft(currentSettings: BackupSyncSettings | null): BackupSyncSettings {
  if (currentSettings?.provider && currentSettings.provider !== 'none') {
    return { ...currentSettings }
  }
  return createBackupSyncDraft('webdav', currentSettings)
}
