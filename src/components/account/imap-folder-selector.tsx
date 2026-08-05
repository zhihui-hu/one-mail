import * as React from 'react'
import type { FieldPath, UseFormReturn } from 'react-hook-form'

import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { FieldError } from '@renderer/components/ui/field'
import { discoverImapFolders } from '@renderer/lib/api'
import { useI18n } from '@renderer/lib/i18n'
import type { ImapFolder, ImapFolderDiscoveryInput, ImapSyncFolder } from '@renderer/shared/types'
import {
  normalizeAccountPassword,
  resolveProviderPreset,
  type AccountFormValues,
  type AccountKind
} from './account-form-types'

type ImapFolderSelectorProps = {
  form: UseFormReturn<AccountFormValues>
  kind: AccountKind
}

const CONNECTION_FIELDS: FieldPath<AccountFormValues>[] = [
  'email',
  'password',
  'imapHost',
  'imapPort',
  'imapSecurity'
]

export function ImapFolderSelector({ form, kind }: ImapFolderSelectorProps): React.JSX.Element {
  const { t } = useI18n()
  const [pending, setPending] = React.useState(false)
  const [discovered, setDiscovered] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const requestVersionRef = React.useRef(0)
  const email = form.watch('email') ?? ''
  const password = form.watch('password') ?? ''
  const authType = form.watch('authType')
  const imapHost = form.watch('imapHost') ?? ''
  const imapPort = form.watch('imapPort')
  const imapSecurity = form.watch('imapSecurity')
  const syncFolders = form.watch('syncFolders')

  React.useEffect(() => {
    requestVersionRef.current += 1
    setPending(false)
    setDiscovered(false)
    setError(null)
    form.setValue('syncFolders', [])
  }, [authType, email, form, imapHost, imapPort, imapSecurity, kind, password])

  async function handleDiscover(): Promise<void> {
    const valid = await form.trigger(CONNECTION_FIELDS, { shouldFocus: true })
    if (!valid) return

    const input = getDiscoveryInput(form.getValues(), kind)
    const requestVersion = requestVersionRef.current
    setPending(true)
    setDiscovered(false)
    setError(null)
    form.setValue('syncFolders', [])

    try {
      const folders = await discoverImapFolders(input)
      if (requestVersion !== requestVersionRef.current) return

      form.setValue(
        'syncFolders',
        folders.map(toInitialSyncFolder),
        { shouldDirty: true }
      )
      setDiscovered(true)
    } catch (discoverError) {
      if (requestVersion !== requestVersionRef.current) return
      setError(formatDiscoveryError(discoverError, t('account.form.folderDiscoveryError')))
    } finally {
      if (requestVersion === requestVersionRef.current) setPending(false)
    }
  }

  function handleFolderChange(path: string, checked: boolean): void {
    form.setValue(
      'syncFolders',
      syncFolders.map((folder) =>
        folder.path === path && folder.isSelectable && !isInboxFolder(folder)
          ? { ...folder, syncEnabled: checked }
          : folder
      ),
      { shouldDirty: true }
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-muted/10 p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium">{t('account.form.syncFolders')}</div>
          <div className="text-xs leading-5 text-muted-foreground">
            {t('account.form.syncFoldersDescription')}
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={handleDiscover}>
          {pending
            ? t('account.form.discoveringFolders')
            : discovered
              ? t('account.form.refreshFolders')
              : t('account.form.selectFolders')}
        </Button>
      </div>

      {error ? <FieldError className="text-xs">{error}</FieldError> : null}

      {discovered ? (
        syncFolders.length > 0 ? (
          <div className="max-h-40 overflow-y-auto rounded-md border bg-background p-1">
            {syncFolders.map((folder) => {
              const inbox = isInboxFolder(folder)
              const disabled = inbox || !folder.isSelectable

              return (
                <label
                  key={folder.path}
                  className="flex min-h-8 items-center gap-2 rounded px-2 text-xs hover:bg-muted/45"
                >
                  <Checkbox
                    checked={folder.syncEnabled}
                    disabled={disabled}
                    onCheckedChange={(checked) => handleFolderChange(folder.path, checked === true)}
                  />
                  <span className="min-w-0 flex-1 truncate" title={folder.path}>
                    {folder.name || folder.path}
                  </span>
                  {!folder.isSelectable ? (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {t('account.form.folderNotSelectable')}
                    </span>
                  ) : null}
                </label>
              )
            })}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">{t('account.form.noFolders')}</div>
        )
      ) : null}
    </div>
  )
}

function getDiscoveryInput(
  values: AccountFormValues,
  kind: AccountKind
): ImapFolderDiscoveryInput {
  const preset = resolveProviderPreset(kind, values.email)

  return {
    email: values.email?.trim() ?? '',
    password: normalizeAccountPassword(values.password ?? '', values.authType),
    imapHost: kind === 'custom' ? values.imapHost?.trim() ?? '' : preset.imapHost,
    imapPort: kind === 'custom' ? values.imapPort : preset.imapPort,
    imapSecurity: kind === 'custom' ? values.imapSecurity : preset.imapSecurity
  }
}

function toInitialSyncFolder(folder: ImapFolder): ImapSyncFolder {
  return {
    ...folder,
    syncEnabled: isInboxFolder(folder)
  }
}

function isInboxFolder(folder: Pick<ImapFolder, 'path' | 'role'>): boolean {
  return folder.role.toLowerCase() === 'inbox' || folder.path.toUpperCase() === 'INBOX'
}

function formatDiscoveryError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const message = error.message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()
  return message || fallback
}
