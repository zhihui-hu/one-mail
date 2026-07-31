import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Message } from './types'
import { MailReader } from './mail-reader'
import { I18nProvider } from '@renderer/lib/i18n'

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
    renderMailReader(
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
    renderMailReader(
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

describe('MailReader remote content', () => {
  it('shows full remote content automatically when remote blocking is disabled', async () => {
    const { container } = renderMailReader(
      <MailReader
        message={createMessage({
          html: '<p>Hello</p><img src="https://example.com/tracker.png">',
          bodyLoaded: true
        })}
        recipientAddress="account@example.com"
        externalImagesBlocked={false}
        onLoadBody={() => {}}
      />
    )

    await waitFor(() => {
      expect(container.querySelector('img')?.getAttribute('src')).toBe(
        'https://example.com/tracker.png'
      )
    })
    expect(screen.queryByText('加载完整内容')).not.toBeInTheDocument()
  })

  it('keeps remote content behind the full-content action by default', async () => {
    renderMailReader(
      <MailReader
        message={createMessage({
          html: '<p>Hello</p><img src="https://example.com/tracker.png">',
          bodyLoaded: true
        })}
        recipientAddress="account@example.com"
        onLoadBody={() => {}}
      />
    )

    expect(await screen.findByText('加载完整内容')).toBeInTheDocument()
  })
})

function renderMailReader(ui: React.ReactElement): ReturnType<typeof render> {
  return render(<I18nProvider>{ui}</I18nProvider>)
}
