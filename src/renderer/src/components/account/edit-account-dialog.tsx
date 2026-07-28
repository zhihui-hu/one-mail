import { zodResolver } from '@hookform/resolvers/zod'
import { RefreshCw } from 'lucide-react'
import * as React from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'

import type { Account } from '@renderer/components/mail/types'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { FieldError, FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { discoverAccountFolders } from '@renderer/lib/api'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import type { AccountMailFolder, AccountUpdateInput, SmtpSecurity } from '../../../../shared/types'
import { AccountFormField } from './account-form-field'

type EditAccountValues = {
  accountLabel?: string
  password?: string
  smtpEnabled: boolean
  smtpHost?: string
  smtpPort: number
  smtpSecurity: SmtpSecurity
}

type EditAccountDialogProps = {
  account: Account
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: AccountUpdateInput) => Promise<void>
}

export function EditAccountDialog({
  account,
  open,
  onOpenChange,
  onSubmit
}: EditAccountDialogProps): React.JSX.Element {
  const { t } = useI18n()
  const isCustomAccount = isCustomProvider(account.providerKey)
  const editAccountSchema = React.useMemo(
    () => createEditAccountSchema(t, isCustomAccount),
    [isCustomAccount, t]
  )
  const [pending, setPending] = React.useState(false)
  const [folderPending, setFolderPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [folders, setFolders] = React.useState<AccountMailFolder[] | null>(null)
  const [selectedFolderPaths, setSelectedFolderPaths] = React.useState<Set<string>>(new Set())
  const isOAuthAccount = account.authType === 'oauth2'
  const form = useForm<EditAccountValues>({
    resolver: zodResolver(editAccountSchema),
    defaultValues: getDefaultValues(account)
  })
  const smtpEnabled = form.watch('smtpEnabled')

  React.useEffect(() => {
    if (!open) return
    form.reset(getDefaultValues(account))
    setFolders(null)
    setSelectedFolderPaths(new Set())
    setError(null)
  }, [account, form, open])

  function handleOpenChange(nextOpen: boolean): void {
    if ((pending || folderPending) && !nextOpen) return
    if (!nextOpen) setError(null)
    onOpenChange(nextOpen)
  }

  async function handleDiscoverFolders(): Promise<void> {
    if (!account.accountId) return

    setFolderPending(true)
    setError(null)
    try {
      const discovered = await discoverAccountFolders(account.accountId)
      setFolders(discovered)
      setSelectedFolderPaths(
        new Set(discovered.filter((folder) => folder.selected).map((folder) => folder.path))
      )
    } catch (discoverError) {
      setError(
        discoverError instanceof Error ? discoverError.message : t('account.folders.discoverError')
      )
    } finally {
      setFolderPending(false)
    }
  }

  function handleFolderChecked(folder: AccountMailFolder, checked: boolean): void {
    if (folder.role === 'inbox') return

    setSelectedFolderPaths((current) => {
      const next = new Set(current)
      if (checked) next.add(folder.path)
      else next.delete(folder.path)
      return next
    })
  }

  async function handleSubmit(values: EditAccountValues): Promise<void> {
    if (!account.accountId) return

    setPending(true)
    setError(null)

    const password = optionalText(values.password)
    if (!isOAuthAccount && account.credentialState !== 'stored' && !password) {
      setError(t('account.edit.missingCredentialError'))
      setPending(false)
      return
    }

    try {
      await onSubmit({
        accountId: account.accountId,
        accountLabel: values.accountLabel?.trim() ?? '',
        password: isOAuthAccount ? undefined : password,
        smtpEnabled: isCustomAccount ? values.smtpEnabled : undefined,
        smtpHost: isCustomAccount && values.smtpEnabled ? values.smtpHost?.trim() : undefined,
        smtpPort: isCustomAccount && values.smtpEnabled ? values.smtpPort : undefined,
        smtpSecurity: isCustomAccount && values.smtpEnabled ? values.smtpSecurity : undefined,
        selectedFolderPaths: folders ? Array.from(selectedFolderPaths) : undefined
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('account.add.saveError'))
    } finally {
      setPending(false)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('account.edit.title')}
      description={
        isOAuthAccount
          ? t('account.edit.oauthDescription')
          : account.credentialState === 'stored'
            ? t('account.edit.storedDescription')
            : t('account.edit.missingCredentialDescription')
      }
      contentClassName="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[520px]"
      bodyClassName="min-h-0 overflow-auto pr-1"
      footer={
        <>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            form="edit-account-form"
            disabled={pending || folderPending || !account.accountId}
          >
            {pending
              ? isOAuthAccount
                ? t('common.saving')
                : t('common.testing')
              : t('account.edit.saveChanges')}
          </Button>
        </>
      }
    >
      <form
        id="edit-account-form"
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit(handleSubmit)}
      >
        <FieldGroup className="gap-2.5">
          <AccountFormField id="edit-account-email" label={t('account.form.email')}>
            <Input id="edit-account-email" type="email" value={account.address} disabled />
          </AccountFormField>
          <AccountFormField
            id="edit-account-label"
            label={t('account.form.label')}
            error={form.formState.errors.accountLabel?.message}
          >
            <Input
              id="edit-account-label"
              placeholder={t('account.form.labelPlaceholder')}
              aria-invalid={Boolean(form.formState.errors.accountLabel)}
              {...form.register('accountLabel')}
            />
          </AccountFormField>
          {isOAuthAccount ? null : (
            <AccountFormField
              id="edit-account-password"
              label={t('account.form.passwordOrAuthCode')}
              required={account.credentialState !== 'stored'}
              error={form.formState.errors.password?.message}
            >
              <Input
                id="edit-account-password"
                type="password"
                autoComplete="current-password"
                placeholder={
                  account.credentialState === 'stored'
                    ? t('account.edit.keepSavedCredential')
                    : t('account.edit.passwordPlaceholder')
                }
                required={account.credentialState !== 'stored'}
                aria-invalid={Boolean(form.formState.errors.password)}
                {...form.register('password')}
              />
            </AccountFormField>
          )}
        </FieldGroup>

        {isCustomAccount ? (
          <section className="flex flex-col gap-2.5 border-t pt-4">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="edit-smtp-enabled" className="text-sm font-medium">
                {t('account.form.smtpEnabled')}
              </label>
              <Controller
                control={form.control}
                name="smtpEnabled"
                render={({ field }) => (
                  <Switch
                    id="edit-smtp-enabled"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label={t('account.form.smtpEnabled')}
                  />
                )}
              />
            </div>

            {smtpEnabled ? (
              <>
                <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_112px]">
                  <AccountFormField
                    id="edit-smtp-host"
                    label={t('account.form.smtpHost')}
                    required
                    error={form.formState.errors.smtpHost?.message}
                  >
                    <Input
                      id="edit-smtp-host"
                      placeholder="smtp.example.com"
                      required
                      aria-invalid={Boolean(form.formState.errors.smtpHost)}
                      {...form.register('smtpHost')}
                    />
                  </AccountFormField>
                  <AccountFormField
                    id="edit-smtp-port"
                    label={t('account.form.port')}
                    required
                    error={form.formState.errors.smtpPort?.message}
                  >
                    <Input
                      id="edit-smtp-port"
                      type="number"
                      min={1}
                      max={65535}
                      required
                      aria-invalid={Boolean(form.formState.errors.smtpPort)}
                      {...form.register('smtpPort', { valueAsNumber: true })}
                    />
                  </AccountFormField>
                </div>
                <AccountFormField
                  id="edit-smtp-security"
                  label={t('account.form.security')}
                  required
                  error={form.formState.errors.smtpSecurity?.message}
                >
                  <Controller
                    control={form.control}
                    name="smtpSecurity"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange} required>
                        <SelectTrigger id="edit-smtp-security" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectItem value="ssl_tls">SSL/TLS</SelectItem>
                            <SelectItem value="starttls">STARTTLS</SelectItem>
                            <SelectItem value="none">{t('account.form.securityNone')}</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </AccountFormField>
              </>
            ) : null}
          </section>
        ) : null}

        <section className="flex flex-col gap-2.5 border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">{t('account.folders.title')}</h3>
              <p className="text-xs text-muted-foreground">{t('account.folders.description')}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={folderPending || !account.accountId}
              onClick={() => void handleDiscoverFolders()}
            >
              <RefreshCw className={folderPending ? 'animate-spin' : undefined} />
              {folderPending ? t('account.folders.loading') : t('account.folders.refresh')}
            </Button>
          </div>

          {folders ? (
            <div className="max-h-52 overflow-y-auto border-y">
              {folders
                .filter((folder) => folder.selectable)
                .map((folder) => {
                  const checked = folder.role === 'inbox' || selectedFolderPaths.has(folder.path)
                  return (
                    <label
                      key={folder.path}
                      className="flex min-h-10 items-center gap-3 border-b px-1 py-2 last:border-b-0"
                    >
                      <Checkbox
                        checked={checked}
                        disabled={folder.role === 'inbox'}
                        onCheckedChange={(value) => handleFolderChecked(folder, value === true)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{folder.name}</span>
                        {folder.name === folder.path ? null : (
                          <span className="block truncate text-xs text-muted-foreground">
                            {folder.path}
                          </span>
                        )}
                      </span>
                    </label>
                  )
                })}
            </div>
          ) : null}
        </section>

        {error ? <FieldError>{error}</FieldError> : null}
      </form>
    </ResponsiveDialog>
  )
}

function createEditAccountSchema(
  t: (key: TranslationKey) => string,
  validateSmtp: boolean
): z.ZodType<EditAccountValues, EditAccountValues> {
  return z
    .object({
      accountLabel: z.string().trim().max(80, t('account.form.labelMax')).optional(),
      password: z.string().trim().optional(),
      smtpEnabled: z.boolean(),
      smtpHost: z.string().trim().optional(),
      smtpPort: z
        .number(t('account.form.portRequired'))
        .int(t('account.form.portInteger'))
        .min(1, t('account.form.portMin'))
        .max(65535, t('account.form.portMax')),
      smtpSecurity: z.enum(['ssl_tls', 'starttls', 'none'])
    })
    .superRefine((values, context) => {
      if (validateSmtp && values.smtpEnabled && !values.smtpHost?.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['smtpHost'],
          message: t('account.form.requiredSmtpHost')
        })
      }
    })
}

function getDefaultValues(account: Account): EditAccountValues {
  return {
    accountLabel: getInitialLabel(account),
    password: '',
    smtpEnabled: account.smtpEnabled ?? false,
    smtpHost: account.smtpHost ?? '',
    smtpPort: account.smtpPort ?? 465,
    smtpSecurity: account.smtpSecurity ?? 'ssl_tls'
  }
}

function getInitialLabel(account: Account): string {
  const suffix = `(${account.address})`
  if (!account.name.endsWith(suffix)) return ''
  return account.name.slice(0, -suffix.length)
}

function isCustomProvider(providerKey?: string): boolean {
  const normalized = providerKey?.trim().toLowerCase() ?? ''
  return normalized.includes('custom') || normalized.includes('manual')
}

function optionalText(value?: string): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}
