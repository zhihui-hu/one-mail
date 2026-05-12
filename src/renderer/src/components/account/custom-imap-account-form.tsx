import type * as React from 'react'
import { Controller, type UseFormReturn } from 'react-hook-form'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Input } from '@renderer/components/ui/input'
import type { AccountFormValues } from './account-form-types'
import { AccountFormField } from './account-form-field'
import { CommonAccountFields } from './common-account-fields'

type CustomImapAccountFormProps = {
  form: UseFormReturn<AccountFormValues>
}

export function CustomImapAccountForm({ form }: CustomImapAccountFormProps): React.JSX.Element {
  return (
    <>
      <CommonAccountFields
        form={form}
        passwordLabel="密码"
        passwordPlaceholder="邮箱密码或客户端授权码"
      />

      <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_112px]">
        <AccountFormField
          id="imap-host"
          label="IMAP 服务器"
          required
          error={form.formState.errors.imapHost?.message}
        >
          <Input
            id="imap-host"
            placeholder="imap.example.com"
            required
            aria-invalid={Boolean(form.formState.errors.imapHost)}
            {...form.register('imapHost')}
          />
        </AccountFormField>

        <AccountFormField
          id="imap-port"
          label="端口"
          required
          error={form.formState.errors.imapPort?.message}
        >
          <Input
            id="imap-port"
            type="number"
            min={1}
            max={65535}
            required
            aria-invalid={Boolean(form.formState.errors.imapPort)}
            {...form.register('imapPort', { valueAsNumber: true })}
          />
        </AccountFormField>
      </div>

      <AccountFormField
        id="imap-security"
        label="连接安全"
        required
        error={form.formState.errors.imapSecurity?.message}
      >
        <Controller
          control={form.control}
          name="imapSecurity"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} required>
              <SelectTrigger
                id="imap-security"
                className="w-full"
                aria-label="连接安全"
                aria-invalid={Boolean(form.formState.errors.imapSecurity)}
              >
                <SelectValue placeholder="连接安全" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="ssl_tls">SSL/TLS</SelectItem>
                  <SelectItem value="starttls">STARTTLS</SelectItem>
                  <SelectItem value="none">无加密</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        />
      </AccountFormField>
    </>
  )
}
