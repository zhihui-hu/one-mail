import { zodResolver } from '@hookform/resolvers/zod'
import * as React from 'react'
import { useForm } from 'react-hook-form'

import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { FieldError, FieldGroup } from '@renderer/components/ui/field'
import { useI18n } from '@renderer/lib/i18n'
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
  createAccountSchema,
  defaultAccountFormValues,
  getProviderPreset,
  providerPresets,
  resolveProviderPreset,
  type AccountFormValues,
  type AccountKind
} from './account-form-types'
import { AccountFormField } from './account-form-field'
import { CommonAccountFields } from './common-account-fields'
import { CustomImapAccountForm } from './custom-imap-account-form'
import { OutlookAccountForm } from './outlook-account-form'

const ACCOUNT_ADD_GUIDE_URL =
  'https://huzhihui.com/blog/personal-email-account-add-guide-imap-smtp-app-password'

type AddAccountDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: AccountCreateInput) => Promise<void>
}

type AddAccountFormProps = {
  onSubmit: (input: AccountCreateInput) => Promise<void>
  className?: string
  bodyClassName?: string
  footerClassName?: string
}

export function AddAccountForm({
  onSubmit,
  className = 'flex min-h-0 flex-col gap-3',
  bodyClassName = 'flex flex-col gap-3',
  footerClassName = 'flex justify-end'
}: AddAccountFormProps): React.JSX.Element {
  const { t } = useI18n()
  const accountSchema = React.useMemo(() => createAccountSchema(t), [t])
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [kind, setKind] = React.useState<AccountKind>(defaultAccountFormValues.kind)
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: defaultAccountFormValues,
    mode: 'onSubmit'
  })

  function handleKindChange(nextKind: string): void {
    const preset = getProviderPreset(nextKind as AccountKind)

    setKind(preset.kind)
    form.setValue('kind', preset.kind)
    form.setValue('providerKey', preset.providerKey)
    form.setValue('authType', preset.authType)
    form.setValue('imapHost', preset.imapHost)
    form.setValue('imapPort', preset.imapPort)
    form.setValue('imapSecurity', preset.imapSecurity)
    form.setValue('smtpHost', preset.smtpHost ?? '')
    form.setValue('smtpPort', preset.smtpPort ?? 465)
    form.setValue('smtpSecurity', preset.smtpSecurity ?? 'ssl_tls')
    form.setValue('smtpEnabled', preset.smtpEnabled ?? false)
    form.clearErrors()
    setError(null)
  }

  async function handleSubmit(values: AccountFormValues): Promise<void> {
    setPending(true)
    setError(null)

    const preset = resolveProviderPreset(values.kind, values.email)

    try {
      await onSubmit({
        providerKey: preset.providerKey,
        email: values.email?.trim(),
        password: values.password ? normalizePassword(values.password, preset.authType) : undefined,
        accountLabel: optionalText(values.accountLabel),
        authType: preset.authType,
        oauthAuthorizationMode: preset.authType === 'oauth2' ? 'internal_browser' : undefined,
        imapHost:
          values.kind === 'custom' ? values.imapHost?.trim() || preset.imapHost : preset.imapHost,
        imapPort: values.kind === 'custom' ? values.imapPort : preset.imapPort,
        imapSecurity: values.kind === 'custom' ? values.imapSecurity : preset.imapSecurity,
        smtpHost: values.kind === 'custom' ? values.smtpHost?.trim() || undefined : preset.smtpHost,
        smtpPort: values.kind === 'custom' ? values.smtpPort : preset.smtpPort,
        smtpSecurity: values.kind === 'custom' ? values.smtpSecurity : preset.smtpSecurity,
        smtpAuthType: values.kind === 'custom' ? values.authType : preset.smtpAuthType,
        smtpEnabled: values.kind === 'custom' ? values.smtpEnabled : preset.smtpEnabled
      })
      form.reset(defaultAccountFormValues)
      setKind(defaultAccountFormValues.kind)
    } catch (submitError) {
      setError(formatAccountSubmitError(submitError, t('account.add.saveError'), values.kind))
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      id="add-account-form"
      className={className}
      onSubmit={form.handleSubmit((values) => handleSubmit(values))}
    >
      <div className={bodyClassName}>
        <AccountAddGuideHint kind={kind} />

        {error ? (
          <FieldError className="rounded-md border border-destructive/25 bg-destructive/5 p-2 text-xs leading-5">
            {error}
          </FieldError>
        ) : null}

        <AccountFormField id="account-kind" label={t('account.form.type')} required>
          <Select value={kind} onValueChange={handleKindChange} required>
            <SelectTrigger id="account-kind" aria-label={t('account.form.type')} className="w-full">
              <SelectValue placeholder={t('account.form.type')} />
            </SelectTrigger>
            <SelectContent viewportClassName="max-h-64 overflow-y-auto">
              <SelectGroup>
                {providerPresets.map((preset) => (
                  <SelectItem key={preset.kind} value={preset.kind}>
                    {t(preset.labelKey)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </AccountFormField>

        <FieldGroup className="gap-2.5">{renderProviderForm(kind, form, t)}</FieldGroup>

      </div>

      <div className={footerClassName}>
        <Button type="submit" disabled={pending}>
          {pending
            ? kind === 'outlook'
              ? t('account.add.waitingAuth')
              : t('common.testing')
            : kind === 'outlook'
              ? t('account.add.microsoftLogin')
              : t('account.add.saveAccount')}
        </Button>
      </div>
    </form>
  )
}

export function AddAccountDialog({
  open,
  onOpenChange,
  onSubmit
}: AddAccountDialogProps): React.JSX.Element {
  const { t } = useI18n()

  function handleOpenChange(nextOpen: boolean): void {
    onOpenChange(nextOpen)
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('account.add.title')}
      contentClassName="h-[min(560px,calc(100vh-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-3 p-4 sm:w-[440px] sm:max-w-[440px]"
      bodyClassName="min-h-0"
    >
      <AddAccountForm
        key={open ? 'open' : 'closed'}
        onSubmit={onSubmit}
        className="flex h-full min-h-0 flex-col gap-3"
        bodyClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-auto"
      />
    </ResponsiveDialog>
  )
}

function renderProviderForm(
  kind: AccountKind,
  form: ReturnType<typeof useForm<AccountFormValues>>,
  t: ReturnType<typeof useI18n>['t']
): React.JSX.Element {
  if (kind === 'outlook') return <OutlookAccountForm form={form} />
  if (kind === 'custom') return <CustomImapAccountForm form={form} />

  const preset = getProviderPreset(kind)

  return (
    <CommonAccountFields
      form={form}
      passwordLabel={t(preset.passwordLabelKey ?? 'account.form.passwordOrAuthCode')}
      passwordPlaceholder={t(preset.passwordPlaceholderKey ?? 'account.form.passwordPlaceholder')}
    />
  )
}

function AccountAddGuideHint({ kind }: { kind: AccountKind }): React.JSX.Element {
  const { t } = useI18n()
  const preset = getProviderPreset(kind)
  const label = t(preset.labelKey)

  return (
    <Alert variant="warning">
      <AlertDescription className="text-xs leading-5">
        {getAccountGuideText(kind, label, t)}
        <a href={ACCOUNT_ADD_GUIDE_URL} target="_blank" rel="noreferrer">
          {t('account.add.guideLink')}
        </a>
      </AlertDescription>
    </Alert>
  )
}

function getAccountGuideText(
  kind: AccountKind,
  label: string,
  t: ReturnType<typeof useI18n>['t']
): string {
  const preset = getProviderPreset(kind)
  if (preset.guideKey) return t(preset.guideKey, { label })

  if (kind === 'custom') return t('account.add.guide.custom')

  return t('account.add.guide.default', { label })
}

function optionalText(value?: string): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}

function normalizePassword(value: string, authType: AccountCreateInput['authType']): string {
  const password = value.trim()
  return authType === 'app_password' ? password.replace(/\s+/g, '') : password
}

function formatAccountSubmitError(error: unknown, fallback: string, kind: AccountKind): string {
  if (!(error instanceof Error)) return fallback

  const message = error.message
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()

  if (kind === 'aliyunEnterprise' && /IMAP 登录认证失败：.*LOGIN failed/i.test(message)) {
    return [
      '阿里企业邮箱登录认证失败：服务器拒绝了当前账号或密码/专用密码。',
      '请让管理员确认已允许使用三方客户端，并已为当前账号开启 IMAP/SMTP 服务；服务器为 imap.qiye.aliyun.com，SSL 端口 993。',
      '如果企业强制启用或账号已开启三方客户端安全密码，请在网页端生成安全密码，并在这里填写该密码，不要使用网页登录密码。',
      '如果企业限制了三方客户端安全登录 IP，请确认当前网络 IP 已被允许。'
    ].join(' ')
  }

  return message
}
