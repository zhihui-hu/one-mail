import { describe, expect, it } from 'vitest'

import { isOAuthSmtpAuthError } from './smtp-send'

describe('smtp send OAuth retry detection', () => {
  it('treats nodemailer auth errors as OAuth retryable', () => {
    const error = new Error('Invalid login: 535 5.7.3 Authentication unsuccessful')
    ;(error as { code?: string }).code = 'EAUTH'

    expect(isOAuthSmtpAuthError(error)).toBe(true)
  })

  it('does not retry unrelated SMTP failures as OAuth errors', () => {
    const error = new Error('Message rejected: mailbox unavailable')
    ;(error as { code?: string }).code = 'EENVELOPE'

    expect(isOAuthSmtpAuthError(error)).toBe(false)
  })
})
