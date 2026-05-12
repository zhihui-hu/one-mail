import type * as React from 'react'
import type { UseFormReturn } from 'react-hook-form'

import { Input } from '@renderer/components/ui/input'
import type { AccountFormValues } from './account-form-types'
import { AccountFormField } from './account-form-field'

type CommonAccountFieldsProps = {
  form: UseFormReturn<AccountFormValues>
  passwordLabel: string
  passwordPlaceholder: string
}

export function CommonAccountFields({
  form,
  passwordLabel,
  passwordPlaceholder
}: CommonAccountFieldsProps): React.JSX.Element {
  return (
    <>
      <AccountFormField
        id="account-email"
        label="邮箱地址"
        required
        error={form.formState.errors.email?.message}
      >
        <Input
          id="account-email"
          type="email"
          autoComplete="email"
          placeholder="name@example.com"
          required
          aria-invalid={Boolean(form.formState.errors.email)}
          {...form.register('email')}
        />
      </AccountFormField>

      <AccountFormField
        id="account-password"
        label={passwordLabel}
        required
        error={form.formState.errors.password?.message}
      >
        <Input
          id="account-password"
          type="password"
          autoComplete="current-password"
          placeholder={passwordPlaceholder}
          required
          aria-invalid={Boolean(form.formState.errors.password)}
          {...form.register('password')}
        />
      </AccountFormField>

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
