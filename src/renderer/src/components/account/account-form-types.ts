import { z } from 'zod'

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
    label: '163 邮箱',
    providerKey: '163',
    authType: 'app_password',
    imapHost: 'imap.163.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls'
  },
  {
    kind: 'qq',
    label: 'QQ 邮箱',
    providerKey: 'qq',
    authType: 'app_password',
    imapHost: 'imap.qq.com',
    imapPort: 993,
    imapSecurity: 'ssl_tls'
  },
  {
    kind: 'custom',
    label: '自定义 IMAP',
    providerKey: 'custom_imap',
    authType: 'manual',
    imapHost: '',
    imapPort: 993,
    imapSecurity: 'ssl_tls'
  }
]

export const accountSchema = z
  .object({
    kind: z.enum(['gmail', 'outlook', 'netease163', 'qq', 'custom']),
    email: z.string().trim().optional(),
    password: z.string().trim().optional(),
    accountLabel: z.string().trim().max(80, '别名不能超过 80 个字符').optional(),
    providerKey: z.string().trim(),
    authType: z.enum(['oauth2', 'app_password', 'password', 'bridge', 'manual']),
    imapHost: z.string().trim().optional(),
    imapPort: z.coerce
      .number<number>('请输入端口')
      .int('端口必须是整数')
      .min(1, '端口不能小于 1')
      .max(65535, '端口不能大于 65535'),
    imapSecurity: z.enum(['ssl_tls', 'starttls', 'none'])
  })
  .superRefine((value, context) => {
    if (value.kind !== 'outlook' && !z.email().safeParse(value.email).success) {
      context.addIssue({
        code: 'custom',
        path: ['email'],
        message: '请输入有效的邮箱地址'
      })
    }

    if (value.kind !== 'outlook' && !value.password?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['password'],
        message: '请输入密码或授权码'
      })
    }

    if (value.kind !== 'custom') return

    if (!value.imapHost?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['imapHost'],
        message: '请输入 IMAP 服务器'
      })
    }
  })

export type AccountFormValues = z.infer<typeof accountSchema>

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
