import type * as React from 'react'
import type { UseFormReturn } from 'react-hook-form'

import type { AccountFormValues } from './account-form-types'
import { CommonAccountFields } from './common-account-fields'

type GmailAccountFormProps = {
  form: UseFormReturn<AccountFormValues>
}

export function GmailAccountForm({ form }: GmailAccountFormProps): React.JSX.Element {
  return (
    <CommonAccountFields
      form={form}
      passwordLabel="应用密码"
      passwordPlaceholder="Gmail 应用密码"
    />
  )
}
