import { zodResolver } from '@hookform/resolvers/zod'
import * as React from 'react'
import { useForm } from 'react-hook-form'

import { ResponsiveDialog } from '@renderer/components/responsive-dialog'
import { Alert, AlertDescription } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import { FieldError, FieldGroup } from '@renderer/components/ui/field'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
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
  type AccountFormValues,
  type AccountKind
} from './account-form-types'
import { AccountFormField } from './account-form-field'
import { CustomImapAccountForm } from './custom-imap-account-form'
import { GmailAccountForm } from './gmail-account-form'
import { NeteaseAccountForm } from './netease-account-form'
import { OutlookAccountForm } from './outlook-account-form'
import { QqAccountForm } from './qq-account-form'

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
        oauthAuthorizationMode: preset.authType === 'oauth2' ? 'internal_browser' : undefined,
        imapHost:
          values.kind === 'custom' ? values.imapHost?.trim() || preset.imapHost : preset.imapHost,
        imapPort: values.kind === 'custom' ? values.imapPort : preset.imapPort,
        imapSecurity: values.kind === 'custom' ? values.imapSecurity : preset.imapSecurity
      })
      form.reset(defaultAccountFormValues)
      setKind(defaultAccountFormValues.kind)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('account.add.saveError'))
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

        <AccountFormField id="account-kind" label={t('account.form.type')} required>
          <Select value={kind} onValueChange={handleKindChange} required>
            <SelectTrigger id="account-kind" aria-label={t('account.form.type')} className="w-full">
              <SelectValue placeholder={t('account.form.type')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {providerPresets.map((preset) => (
                  <SelectItem key={preset.kind} value={preset.kind}>
                    {getProviderPresetLabel(preset.kind, t)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </AccountFormField>

        <FieldGroup className="gap-2.5">{renderProviderForm(kind, form)}</FieldGroup>

        {error ? <FieldError>{error}</FieldError> : null}
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
  form: ReturnType<typeof useForm<AccountFormValues>>
): React.JSX.Element {
  if (kind === 'outlook') return <OutlookAccountForm form={form} />
  if (kind === 'netease163') return <NeteaseAccountForm form={form} />
  if (kind === 'qq') return <QqAccountForm form={form} />
  if (kind === 'custom') return <CustomImapAccountForm form={form} />

  return <GmailAccountForm form={form} />
}

function AccountAddGuideHint({ kind }: { kind: AccountKind }): React.JSX.Element {
  const { t } = useI18n()
  const label = getProviderPresetLabel(kind, t)

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
  if (kind === 'gmail') return t('account.add.guide.gmail', { label })
  if (kind === 'netease163') return t('account.add.guide.netease163', { label })
  if (kind === 'qq') return t('account.add.guide.qq', { label })
  if (kind === 'custom') return t('account.add.guide.custom')

  return t('account.add.guide.default', { label })
}

function getProviderPresetLabel(
  kind: AccountKind,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  const labels: Record<AccountKind, TranslationKey> = {
    gmail: 'account.provider.gmail',
    outlook: 'account.provider.outlook',
    netease163: 'account.provider.netease163',
    qq: 'account.provider.qq',
    custom: 'account.provider.custom'
  }

  return t(labels[kind])
}

function optionalText(value?: string): string | undefined {
  const text = value?.trim()
  return text ? text : undefined
}

function normalizePassword(value: string, authType: AccountCreateInput['authType']): string {
  const password = value.trim()
  return authType === 'app_password' ? password.replace(/\s+/g, '') : password
}
