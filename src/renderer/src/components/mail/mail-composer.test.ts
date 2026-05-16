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
})
