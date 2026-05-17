import { zodResolver } from '@hookform/resolvers/zod'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import type { Account } from '@renderer/components/mail/types'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Button } from '@renderer/components/ui/button'
import { FieldError, FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import type { AccountUpdateInput } from '../../../../shared/types'
import { AccountFormField } from './account-form-field'

type EditAccountValues = {
  accountLabel?: string
  password?: string
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
  const editAccountSchema = React.useMemo(() => createEditAccountSchema(t), [t])
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const isOAuthAccount = account.authType === 'oauth2'
  const form = useForm<EditAccountValues>({
    resolver: zodResolver(editAccountSchema),
    defaultValues: {
      accountLabel: getInitialLabel(account),
      password: ''
    }
  })

  React.useEffect(() => {
    if (!open) return
    form.reset({
      accountLabel: getInitialLabel(account),
      password: ''
    })
  }, [account, form, open])

  function handleOpenChange(nextOpen: boolean): void {
    if (pending && !nextOpen) return

    if (!nextOpen) {
      setError(null)
    }
    onOpenChange(nextOpen)
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
        password: isOAuthAccount ? undefined : password
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
      footer={
        <>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="edit-account-form" disabled={pending || !account.accountId}>
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
        className="flex flex-col gap-3"
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

        {error ? <FieldError>{error}</FieldError> : null}
      </form>
    </ResponsiveDialog>
  )
}

function createEditAccountSchema(t: (key: TranslationKey) => string) {
  return z.object({
    accountLabel: z.string().trim().max(80, t('account.form.labelMax')).optional(),
    password: z.string().trim().optional()
  })
}

function getInitialLabel(account: Account): string {
  const suffix = `(${account.address})`
  if (!account.name.endsWith(suffix)) return ''
  return account.name.slice(0, -suffix.length)
}

function optionalText(value?: string): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}
