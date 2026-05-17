import { describe, expect, it } from 'vitest'

import {
  MICROSOFT_LONG_OPERATION_REFRESH_SKEW_MS,
  MICROSOFT_TOKEN_REFRESH_SKEW_MS,
  hasRequiredMicrosoftOutlookScopes,
  shouldRefreshMicrosoftToken
} from './microsoft-oauth'

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

  it('accepts fully qualified IMAP scope and short SMTP scope names', () => {
    expect(
      hasRequiredMicrosoftOutlookScopes(
        new Set(['https://outlook.office.com/imap.accessasuser.all', 'smtp.send'])
      )
    ).toBe(true)
  })

  it('refreshes before expiry using the standard safety window', () => {
    const nowMs = Date.parse('2026-05-17T01:00:00.000Z')

    expect(
      shouldRefreshMicrosoftToken(
        { expiresAt: new Date(nowMs + MICROSOFT_TOKEN_REFRESH_SKEW_MS - 1).toISOString() },
        MICROSOFT_TOKEN_REFRESH_SKEW_MS,
        nowMs
      )
    ).toBe(true)
    expect(
      shouldRefreshMicrosoftToken(
        { expiresAt: new Date(nowMs + MICROSOFT_TOKEN_REFRESH_SKEW_MS + 1).toISOString() },
        MICROSOFT_TOKEN_REFRESH_SKEW_MS,
        nowMs
      )
    ).toBe(false)
  })

  it('uses a longer refresh window for IMAP-style long operations', () => {
    const nowMs = Date.parse('2026-05-17T01:00:00.000Z')

    expect(
      shouldRefreshMicrosoftToken(
        { expiresAt: new Date(nowMs + 12 * 60 * 1000).toISOString() },
        MICROSOFT_TOKEN_REFRESH_SKEW_MS,
        nowMs
      )
    ).toBe(false)
    expect(
      shouldRefreshMicrosoftToken(
        { expiresAt: new Date(nowMs + 12 * 60 * 1000).toISOString() },
        MICROSOFT_LONG_OPERATION_REFRESH_SKEW_MS,
        nowMs
      )
    ).toBe(true)
  })
})
