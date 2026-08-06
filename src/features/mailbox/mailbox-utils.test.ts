import { describe, expect, it } from 'vitest'

import { getErrorMessage } from './mailbox-utils'

describe('getErrorMessage', () => {
  it('keeps Tauri string errors instead of falling back to a generic message', () => {
    expect(getErrorMessage('读取邮箱账号失败：no such column: connection_state', '刷新账号失败。')).toBe(
      '读取邮箱账号失败：no such column: connection_state'
    )
  })

  it('keeps object message fields from invoke-like errors', () => {
    expect(getErrorMessage({ message: 'IMAP 登录失败' }, '刷新账号失败。')).toBe('IMAP 登录失败')
  })
})
