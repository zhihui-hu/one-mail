import { describe, expect, it } from 'vitest'

import { getAttachmentKey, getUnselectedForwardAttachments } from './mail-composer'

describe('MailComposer forwarded attachments', () => {
  it('keeps unselected forward attachments separate from selected attachments', () => {
    const first = {
      sourceMessageId: 1,
      sourceAttachmentId: 10,
      filename: 'one.txt',
      sizeBytes: 100
    }
    const second = {
      sourceMessageId: 1,
      sourceAttachmentId: 11,
      filename: 'two.txt',
      sizeBytes: 200
    }

    expect(getAttachmentKey(first)).toBe('source:1:10')
    expect(
      getUnselectedForwardAttachments(
        {
          kind: 'forward',
          accountId: 1,
          to: [],
          cc: [],
          bcc: [],
          subject: 'Fwd',
          bodyText: '',
          forwardAttachments: [first, second]
        },
        [first]
      )
    ).toEqual([second])
  })

  it('does not confuse forwarded attachments with local attachments of the same filename', () => {
    const forwarded = {
      sourceMessageId: 1,
      sourceAttachmentId: 10,
      filename: 'report.pdf',
      sizeBytes: 100
    }
    const local = {
      filePath: '/tmp/report.pdf',
      filename: 'report.pdf',
      sizeBytes: 100
    }

    expect(getAttachmentKey(forwarded)).not.toBe(getAttachmentKey(local))
    expect(
      getUnselectedForwardAttachments(
        {
          kind: 'forward',
          accountId: 1,
          to: [],
          cc: [],
          bcc: [],
          subject: 'Fwd',
          bodyText: '',
          forwardAttachments: [forwarded]
        },
        [local]
      )
    ).toEqual([forwarded])
  })
})
