import type * as React from 'react'
import type { UseFormReturn } from 'react-hook-form'

import type { AccountFormValues } from './account-form-types'
import { CommonAccountFields } from './common-account-fields'

type NeteaseAccountFormProps = {
  form: UseFormReturn<AccountFormValues>
}

export function NeteaseAccountForm({ form }: NeteaseAccountFormProps): React.JSX.Element {
  return (
    <CommonAccountFields
      form={form}
      passwordLabel="授权码"
      passwordPlaceholder="163 客户端授权码"
    />
  )
}
