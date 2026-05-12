import type * as React from 'react'
import type { UseFormReturn } from 'react-hook-form'

import type { AccountFormValues } from './account-form-types'
import { CommonAccountFields } from './common-account-fields'

type QqAccountFormProps = {
  form: UseFormReturn<AccountFormValues>
}

export function QqAccountForm({ form }: QqAccountFormProps): React.JSX.Element {
  return (
    <CommonAccountFields form={form} passwordLabel="授权码" passwordPlaceholder="QQ 邮箱授权码" />
  )
}
