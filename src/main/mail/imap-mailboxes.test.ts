import { describe, expect, it } from 'vitest'

import { parseImapMailboxList } from './imap-mailboxes'

describe('parseImapMailboxList', () => {
  it('parses selectable folders and standard special-use roles', () => {
    const response = [
      '* LIST (\\HasNoChildren \\Inbox) "/" "INBOX"',
      '* LIST (\\HasNoChildren \\Sent) "/" "Sent Items"',
      '* LIST (\\HasChildren \\Noselect) "/" "Projects"',
      '* LIST (\\HasNoChildren) "/" "Projects/Alpha Team"',
      'A0001 OK LIST completed'
    ].join('\r\n')

    expect(parseImapMailboxList(response)).toEqual([
      expect.objectContaining({ path: 'INBOX', role: 'inbox', selectable: true }),
      expect.objectContaining({ path: 'Sent Items', role: 'sent', selectable: true }),
      expect.objectContaining({ path: 'Projects', role: 'custom', selectable: false }),
      expect.objectContaining({
        path: 'Projects/Alpha Team',
        name: 'Alpha Team',
        role: 'custom',
        selectable: true
      })
    ])
  })

  it('decodes modified UTF-7 names while preserving the remote path', () => {
    const response = '* LIST (\\HasNoChildren) "/" "&V4NXPpCuTvY-"\r\nA0001 OK LIST completed'
    const [folder] = parseImapMailboxList(response)

    expect(folder.path).toBe('&V4NXPpCuTvY-')
    expect(folder.name).toBe('垃圾邮件')
    expect(folder.role).toBe('junk')
  })

  it('deduplicates paths case-insensitively', () => {
    const response = [
      '* LIST (\\Inbox) "/" "INBOX"',
      '* LIST (\\Inbox) "/" "inbox"',
      'A0001 OK LIST completed'
    ].join('\r\n')

    expect(parseImapMailboxList(response)).toHaveLength(1)
  })
})
