import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Message } from './types'
import { MailReader } from './mail-reader'

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: '1',
    messageId: 1,
    accountId: 1,
    folderId: 1,
    from: '很长的发件人名称',
    fromAddress: 'sender@example.com',
    to: '真实收件人 <real-recipient@example.com>',
    subject: '测试邮件',
    preview: '邮件预览',
    body: ['正文内容'],
    bodyStatus: 'ready',
    bodyLoaded: true,
    detailLoaded: true,
    receivedAt: '2026-05-16T08:00:00.000Z',
    time: '16:00',
    dateLabel: '今天',
    unread: false,
    starred: false,
    attachments: [],
    ...overrides
  }
}

describe('MailReader metadata', () => {
  it('uses the message To header before falling back to the account address', () => {
    render(
      <MailReader
        message={createMessage()}
        recipientAddress="account@example.com"
        onLoadBody={() => {}}
      />
    )

    expect(screen.getByText('真实收件人 <real-recipient@example.com>')).toBeInTheDocument()
    expect(screen.queryByText('account@example.com')).not.toBeInTheDocument()
  })

  it('keeps sender and recipient values available as tooltip titles', () => {
    render(
      <MailReader
        message={createMessage()}
        recipientAddress="account@example.com"
        onLoadBody={() => {}}
      />
    )

    expect(screen.getByText('很长的发件人名称 <sender@example.com>')).toHaveAttribute(
      'title',
      '很长的发件人名称 <sender@example.com>'
    )
    expect(screen.getByText('真实收件人 <real-recipient@example.com>')).toHaveAttribute(
      'title',
      '真实收件人 <real-recipient@example.com>'
    )
  })
})
