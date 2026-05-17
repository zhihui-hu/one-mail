import type * as React from 'react'
import type { UseFormReturn } from 'react-hook-form'

import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Input } from '@renderer/components/ui/input'
import { useI18n } from '@renderer/lib/i18n'
import type { AccountFormValues } from './account-form-types'
import { AccountFormField } from './account-form-field'

type OutlookAccountFormProps = {
  form: UseFormReturn<AccountFormValues>
}

export function OutlookAccountForm({ form }: OutlookAccountFormProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <>
      <Alert>
        <AlertTitle>{t('account.outlook.title')}</AlertTitle>
        <AlertDescription>{t('account.outlook.description')}</AlertDescription>
      </Alert>

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
