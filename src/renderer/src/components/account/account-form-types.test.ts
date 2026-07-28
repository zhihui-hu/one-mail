import { describe, expect, it } from 'vitest'

import { createAccountSchema, getProviderPreset } from './account-form-types'

const translateKey = (key: string): string => key

describe('account provider presets', () => {
  it('uses Tencent Exmail IMAP and SMTP endpoints', () => {
    expect(getProviderPreset('qqEnterprise')).toEqual(
      expect.objectContaining({
        providerKey: 'qq_enterprise',
        imapHost: 'imap.exmail.qq.com',
        imapPort: 993,
        smtpHost: 'smtp.exmail.qq.com',
        smtpPort: 465,
        smtpEnabled: true
      })
    )
  })

  it('requires an SMTP host only when custom SMTP sending is enabled', () => {
    const schema = createAccountSchema(translateKey)
    const customAccount = {
      kind: 'custom' as const,
      email: 'user@example.com',
      password: 'secret',
      accountLabel: '',
      providerKey: 'custom_imap',
      authType: 'manual' as const,
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapSecurity: 'ssl_tls' as const,
      smtpHost: '',
      smtpPort: 465,
      smtpSecurity: 'ssl_tls' as const,
      smtpEnabled: true
    }

    expect(schema.safeParse(customAccount).success).toBe(false)
    expect(schema.safeParse({ ...customAccount, smtpEnabled: false }).success).toBe(true)
    expect(schema.safeParse({ ...customAccount, smtpHost: 'smtp.example.com' }).success).toBe(true)
  })
})
