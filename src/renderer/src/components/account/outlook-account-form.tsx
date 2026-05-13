import type * as React from 'react'
import type { UseFormReturn } from 'react-hook-form'

import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Input } from '@renderer/components/ui/input'
import type { AccountFormValues } from './account-form-types'
import { AccountFormField } from './account-form-field'

type OutlookAccountFormProps = {
  form: UseFormReturn<AccountFormValues>
}

export function OutlookAccountForm({ form }: OutlookAccountFormProps): React.JSX.Element {
  return (
    <>
      <Alert>
        <AlertTitle>使用 Microsoft 登录</AlertTitle>
        <AlertDescription>
          点击下方按钮后会打开 OneMail 内置授权窗口完成 Microsoft 授权。OneMail
          会自动读取授权账号邮箱，保存后在后台使用 OAuth2 + IMAP XOAUTH2 同步邮件。
        </AlertDescription>
      </Alert>

      <AccountFormField
        id="account-label"
        label="别名"
        error={form.formState.errors.accountLabel?.message}
      >
        <Input
          id="account-label"
          autoComplete="off"
          placeholder="默认显示邮箱地址"
          aria-invalid={Boolean(form.formState.errors.accountLabel)}
          {...form.register('accountLabel')}
        />
      </AccountFormField>
    </>
  )
}
