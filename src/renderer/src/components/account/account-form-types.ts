import { z } from 'zod'

import type { TranslationKey } from '@renderer/lib/i18n'
import type { AuthType, ImapSecurity, SmtpSecurity } from '../../../../shared/types'

export const accountKinds = [
  'gmail',
  'yahoo',
  'aliyun',
  'aliyunEnterprise',
  'mail189',
  'sohu',
  'qq',
  'outlook',
  'netease163',
  'sina',
  'mail139',
  'mail21cn',
  'perfect',
  'icloud',
  'aol',
  'yandex',
  'mailru',
  'custom'
] as const

export type AccountKind = (typeof accountKinds)[number]

export type ProviderPreset = {
  kind: AccountKind
  labelKey: TranslationKey
  providerKey: string
  authType: AuthType
  imapHost: string
  imapPort: number
  imapSecurity: ImapSecurity
  smtpHost?: string
  smtpPort?: number
  smtpSecurity?: SmtpSecurity
  smtpAuthType?: AuthType
  smtpEnabled?: boolean
  passwordLabelKey?: TranslationKey
  passwordPlaceholderKey?: TranslationKey
  guideKey?: TranslationKey
}

export const providerPresets: ProviderPreset[] = [
  {
    kind: 'gmail',
    labelKey: 'account.provider.gmail',
    providerKey: 'gmail',
    authType: 'app_password',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'app_password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.appPassword',
    passwordPlaceholderKey: 'account.form.gmailPasswordPlaceholder',
    guideKey: 'account.add.guide.gmail'
  },
  {
    kind: 'yahoo',
    labelKey: 'account.provider.yahoo',
    providerKey: 'yahoo',
    authType: 'app_password',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'app_password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.appPassword',
    passwordPlaceholderKey: 'account.form.yahooPasswordPlaceholder',
    guideKey: 'account.add.guide.appPassword'
  },
  {
    kind: 'aliyun',
    labelKey: 'account.provider.aliyun',
    providerKey: 'aliyun',
    authType: 'password',
    imapHost: 'imap.aliyun.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.aliyun.com',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.password',
    passwordPlaceholderKey: 'account.form.aliyunPasswordPlaceholder',
    guideKey: 'account.add.guide.password'
  },
  {
    kind: 'aliyunEnterprise',
    labelKey: 'account.provider.aliyunEnterprise',
    providerKey: 'aliyun_enterprise',
    authType: 'password',
    imapHost: 'imap.qiye.aliyun.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.qiye.aliyun.com',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.passwordOrAuthCode',
    passwordPlaceholderKey: 'account.form.aliyunEnterprisePasswordPlaceholder',
    guideKey: 'account.add.guide.aliyunEnterprise'
  },
  {
    kind: 'mail189',
    labelKey: 'account.provider.mail189',
    providerKey: '189',
    authType: 'password',
    imapHost: 'imap.189.cn',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.189.cn',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.password',
    passwordPlaceholderKey: 'account.form.mail189PasswordPlaceholder',
    guideKey: 'account.add.guide.password'
  },
  {
    kind: 'sohu',
    labelKey: 'account.provider.sohu',
    providerKey: 'sohu',
    authType: 'app_password',
    imapHost: 'imap.sohu.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.sohu.com',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'app_password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.independentPassword',
    passwordPlaceholderKey: 'account.form.sohuPasswordPlaceholder',
    guideKey: 'account.add.guide.independentPassword'
  },
  {
    kind: 'qq',
    labelKey: 'account.provider.qq',
    providerKey: 'qq',
    authType: 'app_password',
    imapHost: 'imap.qq.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.qq.com',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'app_password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.authCode',
    passwordPlaceholderKey: 'account.form.qqPasswordPlaceholder',
    guideKey: 'account.add.guide.qq'
  },
  {
    kind: 'netease163',
    labelKey: 'account.provider.netease163',
    providerKey: '163',
    authType: 'app_password',
    imapHost: 'imap.163.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.163.com',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'app_password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.authCode',
    passwordPlaceholderKey: 'account.form.neteasePasswordPlaceholder',
    guideKey: 'account.add.guide.netease163'
  },
  {
    kind: 'outlook',
    labelKey: 'account.provider.outlook',
    providerKey: 'outlook',
    authType: 'oauth2',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    smtpAuthType: 'oauth2',
    smtpEnabled: true
  },
  {
    kind: 'sina',
    labelKey: 'account.provider.sina',
    providerKey: 'sina',
    authType: 'app_password',
    imapHost: 'imap.sina.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.sina.com',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'app_password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.authCode',
    passwordPlaceholderKey: 'account.form.sinaPasswordPlaceholder',
    guideKey: 'account.add.guide.authCode'
  },
  {
    kind: 'mail139',
    labelKey: 'account.provider.mail139',
    providerKey: '139',
    authType: 'app_password',
    imapHost: 'imap.139.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.139.com',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'app_password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.clientPassword',
    passwordPlaceholderKey: 'account.form.mail139PasswordPlaceholder',
    guideKey: 'account.add.guide.clientPassword'
  },
  {
    kind: 'mail21cn',
    labelKey: 'account.provider.mail21cn',
    providerKey: '21cn',
    authType: 'password',
    imapHost: 'imap.21cn.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.21cn.com',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.password',
    passwordPlaceholderKey: 'account.form.mail21cnPasswordPlaceholder',
    guideKey: 'account.add.guide.password'
  },
  {
    kind: 'perfect',
    labelKey: 'account.provider.perfect',
    providerKey: 'perfect',
    authType: 'app_password',
    imapHost: 'imap.88.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.88.com',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'app_password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.dedicatedPassword',
    passwordPlaceholderKey: 'account.form.perfectPasswordPlaceholder',
    guideKey: 'account.add.guide.dedicatedPassword'
  },
  {
    kind: 'icloud',
    labelKey: 'account.provider.icloud',
    providerKey: 'icloud',
    authType: 'app_password',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    smtpAuthType: 'app_password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.appSpecificPassword',
    passwordPlaceholderKey: 'account.form.icloudPasswordPlaceholder',
    guideKey: 'account.add.guide.dedicatedPassword'
  },
  {
    kind: 'aol',
    labelKey: 'account.provider.aol',
    providerKey: 'aol',
    authType: 'app_password',
    imapHost: 'imap.aol.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.aol.com',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'app_password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.appPassword',
    passwordPlaceholderKey: 'account.form.aolPasswordPlaceholder',
    guideKey: 'account.add.guide.appPassword'
  },
  {
    kind: 'yandex',
    labelKey: 'account.provider.yandex',
    providerKey: 'yandex',
    authType: 'app_password',
    imapHost: 'imap.yandex.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.yandex.com',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'app_password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.appPassword',
    passwordPlaceholderKey: 'account.form.yandexPasswordPlaceholder',
    guideKey: 'account.add.guide.appPassword'
  },
  {
    kind: 'mailru',
    labelKey: 'account.provider.mailru',
    providerKey: 'mailru',
    authType: 'app_password',
    imapHost: 'imap.mail.ru',
    imapPort: 993,
    imapSecurity: 'ssl_tls',
    smtpHost: 'smtp.mail.ru',
    smtpPort: 465,
    smtpSecurity: 'ssl_tls',
    smtpAuthType: 'app_password',
    smtpEnabled: true,
    passwordLabelKey: 'account.form.appSpecificPassword',
    passwordPlaceholderKey: 'account.form.mailruPasswordPlaceholder',
    guideKey: 'account.add.guide.dedicatedPassword'
  },
  {
    kind: 'custom',
    labelKey: 'account.provider.custom',
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
      kind: z.enum(accountKinds),
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

export function resolveProviderPreset(kind: AccountKind, email?: string): ProviderPreset {
  const preset = getProviderPreset(kind)
  if (kind !== 'perfect') return preset

  const domain = email?.trim().toLowerCase().split('@').at(1)
  if (domain === '111.com') {
    return {
      ...preset,
      imapHost: 'imap.111.com',
      smtpHost: 'smtp.111.com'
    }
  }
  if (domain === 'email.cn') {
    return {
      ...preset,
      imapHost: 'imap.email.cn',
      smtpHost: 'smtp.email.cn'
    }
  }

  return preset
}
