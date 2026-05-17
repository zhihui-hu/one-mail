import { z } from 'zod'

import type { TranslationKey } from '@renderer/lib/i18n'
import type { AuthType, ImapSecurity } from '../../../../shared/types'

export type AccountKind = 'gmail' | 'outlook' | 'netease163' | 'qq' | 'custom'

export type ProviderPreset = {
  kind: AccountKind
  label: string
  providerKey: string
  authType: AuthType
  imapHost: string
  imapPort: number
  imapSecurity: ImapSecurity
}

export const providerPresets: ProviderPreset[] = [
  {
    kind: 'gmail',
    label: 'Gmail',
    providerKey: 'gmail',
    authType: 'app_password',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls'
  },
  {
    kind: 'outlook',
    label: 'Outlook',
    providerKey: 'outlook',
    authType: 'oauth2',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls'
  },
  {
    kind: 'netease163',
    label: '163 Mail',
    providerKey: '163',
    authType: 'app_password',
    imapHost: 'imap.163.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls'
  },
  {
    kind: 'qq',
    label: 'QQ Mail',
    providerKey: 'qq',
    authType: 'app_password',
    imapHost: 'imap.qq.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls'
  },
  {
    kind: 'custom',
    label: 'Custom IMAP',
    providerKey: 'custom_imap',
    authType: 'manual',
    imapHost: '',
    imapPort: 993,
    imapSecurity: 'ssl_tls'
  }
]

export function createAccountSchema(t: (key: TranslationKey) => string) {
  return z
    .object({
    kind: z.enum(['gmail', 'outlook', 'netease163', 'qq', 'custom']),
    email: z.string().trim().optional(),
    password: z.string().trim().optional(),
    accountLabel: z.string().trim().max(80, t('account.form.labelMax')).optional(),
    providerKey: z.string().trim(),
    authType: z.enum(['oauth2', 'app_password', 'password', 'bridge', 'manual']),
    imapHost: z.string().trim().optional(),
    imapPort: z.coerce
      .number<number>(t('account.form.portRequired'))
      .int(t('account.form.portInteger'))
      .min(1, t('account.form.portMin'))
      .max(65535, t('account.form.portMax')),
    imapSecurity: z.enum(['ssl_tls', 'starttls', 'none'])
  })
  .superRefine((value, context) => {
    if (value.kind !== 'outlook' && !z.email().safeParse(value.email).success) {
      context.addIssue({
        code: 'custom',
        path: ['email'],
        message: t('account.form.requiredEmail')
      })
    }

    if (value.kind !== 'outlook' && !value.password?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['password'],
        message: t('account.form.requiredPassword')
      })
    }

    if (value.kind !== 'custom') return

    if (!value.imapHost?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['imapHost'],
        message: t('account.form.requiredImapHost')
      })
    }
  })
}

export type AccountFormValues = z.infer<ReturnType<typeof createAccountSchema>>

export const defaultAccountFormValues: AccountFormValues = {
  kind: 'gmail',
  email: '',
  password: '',
  accountLabel: '',
  providerKey: 'gmail',
  authType: 'app_password',
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  imapSecurity: 'ssl_tls'
}

export function getProviderPreset(kind: AccountKind): ProviderPreset {
  return providerPresets.find((preset) => preset.kind === kind) ?? providerPresets[0]
}
