import type * as React from 'react'
import type { UseFormReturn } from 'react-hook-form'

import type { AccountFormValues } from './account-form-types'
import { CommonAccountFields } from './common-account-fields'
import { useI18n } from '@renderer/lib/i18n'

type QqAccountFormProps = {
  form: UseFormReturn<AccountFormValues>
}

export function QqAccountForm({ form }: QqAccountFormProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <CommonAccountFields
      form={form}
      passwordLabel={t('account.form.authCode')}
      passwordPlaceholder={t('account.form.qqPasswordPlaceholder')}
    />
  )
}
