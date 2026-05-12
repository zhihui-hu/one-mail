import { zodResolver } from '@hookform/resolvers/zod'
import * as React from 'react'
import { useForm } from 'react-hook-form'

import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Button } from '@renderer/components/ui/button'
import { FieldError, FieldGroup } from '@renderer/components/ui/field'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import type { AccountCreateInput } from '../../../../shared/types'
import {
  accountSchema,
  defaultAccountFormValues,
  getProviderPreset,
  providerPresets,
  type AccountFormValues,
  type AccountKind
} from './account-form-types'
import { AccountFormField } from './account-form-field'
import { CustomImapAccountForm } from './custom-imap-account-form'
import { GmailAccountForm } from './gmail-account-form'
import { NeteaseAccountForm } from './netease-account-form'
import { OutlookAccountForm } from './outlook-account-form'
import { QqAccountForm } from './qq-account-form'

type AddAccountDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: AccountCreateInput) => Promise<void>
}

export function AddAccountDialog({
  open,
  onOpenChange,
  onSubmit
}: AddAccountDialogProps): React.JSX.Element {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [kind, setKind] = React.useState<AccountKind>(defaultAccountFormValues.kind)
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: defaultAccountFormValues,
    mode: 'onSubmit'
  })

  React.useEffect(() => {
    if (open) return
    form.reset(defaultAccountFormValues)
  }, [form, open])

  function handleOpenChange(nextOpen: boolean): void {
    if (pending && !nextOpen) return

    if (!nextOpen) {
      setError(null)
      setKind(defaultAccountFormValues.kind)
    }
    onOpenChange(nextOpen)
  }

  function handleKindChange(nextKind: string): void {
    const preset = getProviderPreset(nextKind as AccountKind)

    setKind(preset.kind)
    form.setValue('kind', preset.kind)
    form.setValue('providerKey', preset.providerKey)
    form.setValue('authType', preset.authType)
    form.setValue('imapHost', preset.imapHost)
    form.setValue('imapPort', preset.imapPort)
    form.setValue('imapSecurity', preset.imapSecurity)
    form.clearErrors()
    setError(null)
  }

  async function handleSubmit(values: AccountFormValues): Promise<void> {
    setPending(true)
    setError(null)

    const preset = getProviderPreset(values.kind)

    try {
      await onSubmit({
        providerKey: preset.providerKey,
        email: values.email?.trim(),
        password: values.password ? normalizePassword(values.password, preset.authType) : undefined,
        accountLabel: optionalText(values.accountLabel),
        authType: preset.authType,
        imapHost:
          values.kind === 'custom' ? values.imapHost?.trim() || preset.imapHost : preset.imapHost,
        imapPort: values.kind === 'custom' ? values.imapPort : preset.imapPort,
        imapSecurity: values.kind === 'custom' ? values.imapSecurity : preset.imapSecurity
      })
      form.reset(defaultAccountFormValues)
      setKind(defaultAccountFormValues.kind)
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
      title="添加账号"
      contentClassName="max-h-[82vh] gap-3 p-4 sm:max-w-md"
      bodyClassName="min-h-0 overflow-auto"
      footer={
        <>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button type="submit" form="add-account-form" disabled={pending}>
            {pending ? '测试中...' : kind === 'outlook' ? '使用 Microsoft 登录' : '保存账号'}
          </Button>
        </>
      }
    >
      <form
        id="add-account-form"
        className="flex flex-col gap-3"
        onSubmit={form.handleSubmit(handleSubmit)}
      >
        <AccountFormField id="account-kind" label="邮箱类型" required>
          <Select value={kind} onValueChange={handleKindChange} required>
            <SelectTrigger id="account-kind" aria-label="邮箱类型" className="w-full">
              <SelectValue placeholder="邮箱类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {providerPresets.map((preset) => (
                  <SelectItem key={preset.kind} value={preset.kind}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </AccountFormField>

        <FieldGroup className="gap-2.5">{renderProviderForm(kind, form)}</FieldGroup>

        {error ? <FieldError>{error}</FieldError> : null}
      </form>
    </ResponsiveDialog>
  )
}

function renderProviderForm(
  kind: AccountKind,
  form: ReturnType<typeof useForm<AccountFormValues>>
): React.JSX.Element {
  if (kind === 'outlook') return <OutlookAccountForm form={form} />
  if (kind === 'netease163') return <NeteaseAccountForm form={form} />
  if (kind === 'qq') return <QqAccountForm form={form} />
  if (kind === 'custom') return <CustomImapAccountForm form={form} />

  return <GmailAccountForm form={form} />
}

function optionalText(value?: string): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}

function normalizePassword(value: string, authType: AccountCreateInput['authType']): string {
  const password = value.trim()
  return authType === 'app_password' ? password.replace(/\s+/g, '') : password
}
