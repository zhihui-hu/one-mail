import type * as React from 'react'
import type { UseFormReturn } from 'react-hook-form'

import { Input } from '@renderer/components/ui/input'
import { useI18n } from '@renderer/lib/i18n'
import type { AccountFormValues } from './account-form-types'
import { AccountFormField } from './account-form-field'

type GmailAccountFormProps = {
  form: UseFormReturn<AccountFormValues>
}

export function GmailAccountForm({ form }: GmailAccountFormProps): React.JSX.Element {
  const { t } = useI18n()
  const authType = form.watch('authType')
  const usesOAuth = authType === 'oauth2'

  return (
    <>
      <AccountFormField
        id="account-email"
        label={t('account.form.email')}
        required={!usesOAuth}
        error={form.formState.errors.email?.message}
      >
        <Input
          id="account-email"
          type="email"
          autoComplete="email"
          placeholder="name@gmail.com"
          required={!usesOAuth}
          aria-invalid={Boolean(form.formState.errors.email)}
          {...form.register('email')}
        />
      </AccountFormField>

      <div className="flex flex-col gap-1.5 rounded-md border bg-muted/20 p-2 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="gmail-auth-type"
            checked={usesOAuth}
            onChange={() => form.setValue('authType', 'oauth2', { shouldValidate: true })}
          />
          <span>{t('account.form.googleLogin')}</span>
        </label>
      </div>

      <details open={!usesOAuth} className="rounded-md border px-2 py-1.5">
        <summary className="cursor-pointer text-xs font-medium">
          {t('account.form.advancedOptions')}
        </summary>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="radio"
            name="gmail-auth-type"
            checked={authType === 'app_password'}
            onChange={() => form.setValue('authType', 'app_password', { shouldValidate: true })}
          />
          <span>{t('account.form.gmailAppPassword')}</span>
        </label>
      </details>

      {usesOAuth ? (
        <p className="text-xs leading-5 text-muted-foreground">
          {t('account.form.googleLoginDescription')}
        </p>
      ) : (
        <AccountFormField
          id="account-password"
          label={t('account.form.appPassword')}
          required
          error={form.formState.errors.password?.message}
        >
          <Input
            id="account-password"
            type="password"
            autoComplete="current-password"
            placeholder={t('account.form.gmailPasswordPlaceholder')}
            required
            aria-invalid={Boolean(form.formState.errors.password)}
            {...form.register('password')}
          />
        </AccountFormField>
      )}

      <AccountFormField
        id="account-label"
        label={t('account.form.label')}
        error={form.formState.errors.accountLabel?.message}
      >
        <Input
          id="account-label"
          autoComplete="off"
          placeholder={t('account.form.labelPlaceholder')}
          aria-invalid={Boolean(form.formState.errors.accountLabel)}
          {...form.register('accountLabel')}
        />
      </AccountFormField>
    </>
  )
}
