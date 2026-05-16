import { describe, expect, it } from 'vitest'

import { hasRequiredMicrosoftOutlookScopes } from './microsoft-oauth'

describe('Microsoft OAuth scopes', () => {
  it('requires both Outlook IMAP and SMTP scopes', () => {
    expect(
      hasRequiredMicrosoftOutlookScopes(
        new Set(['imap.accessasuser.all', 'https://outlook.office.com/smtp.send'])
      )
    ).toBe(true)

    expect(hasRequiredMicrosoftOutlookScopes(new Set(['imap.accessasuser.all']))).toBe(false)
    expect(hasRequiredMicrosoftOutlookScopes(new Set(['smtp.send']))).toBe(false)
  })
})
