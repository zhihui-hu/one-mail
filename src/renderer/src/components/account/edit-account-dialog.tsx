import { zodResolver } from '@hookform/resolvers/zod'
import * as React from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import type { Account } from '@renderer/components/mail/types'
import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Button } from '@renderer/components/ui/button'
import { FieldError, FieldGroup } from '@renderer/components/ui/field'
import { Input } from '@renderer/components/ui/input'
import type { AccountUpdateInput } from '../../../../shared/types'
import { AccountFormField } from './account-form-field'

const editAccountSchema = z.object({
  accountLabel: z.string().trim().max(80, '别名不能超过 80 个字符').optional(),
  password: z.string().trim().optional()
})

type EditAccountValues = z.infer<typeof editAccountSchema>

type EditAccountDialogProps = {
  account: Account
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: AccountUpdateInput) => Promise<void>
}

export function EditAccountDialog({
  account,
  open,
  onOpenChange,
  onSubmit
}: EditAccountDialogProps): React.JSX.Element {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const form = useForm<EditAccountValues>({
    resolver: zodResolver(editAccountSchema),
    defaultValues: {
      accountLabel: getInitialLabel(account),
      password: ''
    }
  })

  React.useEffect(() => {
    if (!open) return
    form.reset({
      accountLabel: getInitialLabel(account),
      password: ''
    })
  }, [account, form, open])

  function handleOpenChange(nextOpen: boolean): void {
    if (pending && !nextOpen) return

    if (!nextOpen) {
      setError(null)
    }
    onOpenChange(nextOpen)
  }

  async function handleSubmit(values: EditAccountValues): Promise<void> {
    if (!account.accountId) return

    setPending(true)
    setError(null)

    const password = optionalText(values.password)
    if (account.credentialState !== 'stored' && !password) {
      setError('这个账号还没有保存密码或授权码，请填写后再保存。')
      setPending(false)
      return
    }

    try {
      await onSubmit({
        accountId: account.accountId,
        accountLabel: optionalText(values.accountLabel),
        password
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存账号失败。')
    } finally {
      setPending(false)
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="编辑账号"
      description={
        account.credentialState === 'stored'
          ? '保存前会测试邮箱连接是否正常；留空则使用已保存的密码或授权码。'
          : '这个账号还没有保存密码或授权码，保存前需要重新填写并测试连接。'
      }
      footer={
        <>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button type="submit" form="edit-account-form" disabled={pending || !account.accountId}>
            {pending ? '测试中...' : '保存更改'}
          </Button>
        </>
      }
    >
      <form
        id="edit-account-form"
        className="flex flex-col gap-3"
        onSubmit={form.handleSubmit(handleSubmit)}
      >
        <FieldGroup className="gap-2.5">
          <AccountFormField id="edit-account-email" label="邮箱地址">
            <Input id="edit-account-email" type="email" value={account.address} disabled />
          </AccountFormField>
          <AccountFormField
            id="edit-account-label"
            label="别名"
            error={form.formState.errors.accountLabel?.message}
          >
            <Input
              id="edit-account-label"
              placeholder="默认显示邮箱地址"
              aria-invalid={Boolean(form.formState.errors.accountLabel)}
              {...form.register('accountLabel')}
            />
          </AccountFormField>
          <AccountFormField
            id="edit-account-password"
            label="密码或授权码"
            required={account.credentialState !== 'stored'}
            error={form.formState.errors.password?.message}
          >
            <Input
              id="edit-account-password"
              type="password"
              autoComplete="current-password"
              placeholder={
                account.credentialState === 'stored' ? '留空则使用已保存凭据' : '请输入密码或授权码'
              }
              required={account.credentialState !== 'stored'}
              aria-invalid={Boolean(form.formState.errors.password)}
              {...form.register('password')}
            />
          </AccountFormField>
        </FieldGroup>

        {error ? <FieldError>{error}</FieldError> : null}
      </form>
    </ResponsiveDialog>
  )
}

function getInitialLabel(account: Account): string {
  const suffix = `(${account.address})`
  if (!account.name.endsWith(suffix)) return ''
  return account.name.slice(0, -suffix.length)
}

function optionalText(value?: string): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}
