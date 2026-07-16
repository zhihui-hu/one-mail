import { describe, expect, it } from 'vitest'

import { normalizeProviderKey } from './provider-metadata'

describe('normalizeProviderKey', () => {
  it('recognizes Tencent Enterprise Mail before generic QQ mail', () => {
    expect(normalizeProviderKey('tencent_enterprise')).toBe('tencentEnterprise')
    expect(normalizeProviderKey('imap.exmail.qq.com')).toBe('tencentEnterprise')
    expect(normalizeProviderKey('qq')).toBe('qq')
  })
})
