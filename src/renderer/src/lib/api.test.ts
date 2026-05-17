import { describe, expect, it } from 'vitest'

import { toSharedSendInput, toUiComposeDraft } from './api'

describe('compose API mapping', () => {
  it('maps forward attachment candidates into selectable source attachments', () => {
    const draft = toUiComposeDraft({
      accountId: 1,
      mode: 'forward',
      relatedMessageId: 10,
      to: [],
      cc: [],
      bcc: [],
      subject: 'Fwd: report',
      bodyText: 'body',
      forwardAttachments: [
        {
          attachmentId: 20,
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          selected: false
        }
      ]
    })

    expect(draft.forwardAttachments).toEqual([
      {
        sourceMessageId: 10,
        sourceAttachmentId: 20,
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048
      }
    ])
  })

  it('preserves forwarded attachment source ids when sending', () => {
    const input = toSharedSendInput({
      kind: 'forward',
      accountId: 1,
      relatedMessageId: 10,
      to: ['recipient@example.com'],
      subject: 'Fwd: report',
      bodyText: 'body',
      attachments: [
        {
          sourceMessageId: 10,
          sourceAttachmentId: 20,
          filename: 'report.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048
        }
      ]
    })

    expect(input.attachments).toEqual([
      {
        sourceMessageId: 10,
        sourceAttachmentId: 20,
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048
      }
    ])
  })

  it('falls back to attachmentPaths for legacy local-file sends', () => {
    const input = toSharedSendInput({
      kind: 'new',
      accountId: 1,
      to: ['recipient@example.com'],
      subject: 'Local file',
      bodyText: 'body',
      attachmentPaths: ['/tmp/report.pdf']
    })

    expect(input.attachments).toEqual([{ filePath: '/tmp/report.pdf' }])
  })
})
