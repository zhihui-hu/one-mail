import { describe, expect, it } from 'vitest'

import type { Account } from '@renderer/components/mail/types'
import type { TranslationKey } from '@renderer/lib/i18n'
import { getAccountWarning } from './account-warning'

const translate = (key: TranslationKey): string => key

function createAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-1',
    accountId: 1,
    providerKey: 'outlook',
    authType: 'oauth2',
    name: 'owner@example.com',
    address: 'owner@example.com',
    unread: 0,
    status: 'active',
    connectionStatus: 'connected',
    credentialState: 'stored',
    accent: 'blue',
    ...overrides
  }
}

describe('getAccountWarning', () => {
  it('keeps credential failures actionable when a stale sync state remains', () => {
    const warning = getAccountWarning(
      createAccount({ status: 'syncing', connectionStatus: 'renewing', credentialState: 'invalid' }),
      translate
    )

    expect(warning?.primaryAction).toBe('reauthorize')
  })

  it('keeps an ordinary syncing account quiet', () => {
    expect(getAccountWarning(createAccount({ status: 'syncing' }), translate)).toBeNull()
  })
})
