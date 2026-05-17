import type * as React from 'react'
import type { UseFormReturn } from 'react-hook-form'

import type { AccountFormValues } from './account-form-types'
import { CommonAccountFields } from './common-account-fields'
import { useI18n } from '@renderer/lib/i18n'

type GmailAccountFormProps = {
  form: UseFormReturn<AccountFormValues>
}

export function GmailAccountForm({ form }: GmailAccountFormProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <CommonAccountFields
      form={form}
      passwordLabel={t('account.form.appPassword')}
      passwordPlaceholder={t('account.form.gmailPasswordPlaceholder')}
    />
  )
}
