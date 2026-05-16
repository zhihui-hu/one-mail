import { describe, expect, it } from 'vitest'

import { composePlainTextMessage } from './message-composer'

describe('composePlainTextMessage', () => {
  it('includes forwarded attachment content from memory', () => {
    const message = composePlainTextMessage({
      from: { email: 'sender@example.com' },
      to: [{ email: 'recipient@example.com' }],
      subject: 'Forward with attachment',
      bodyText: 'See attached.',
      attachments: [
        {
          sourceMessageId: 1,
          sourceAttachmentId: 2,
          filename: 'original.txt',
          mimeType: 'text/plain',
          content: Buffer.from('forwarded content', 'utf8')
        }
      ]
    })

    expect(message.rawMime).toContain('Content-Type: multipart/mixed;')
    expect(message.rawMime).toContain('original.txt')
    expect(message.rawMime).toContain(Buffer.from('forwarded content', 'utf8').toString('base64'))
  })
})
