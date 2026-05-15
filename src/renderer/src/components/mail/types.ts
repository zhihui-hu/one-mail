export type MailFilterTag = 'unread' | 'starred' | 'today' | 'yesterday' | 'last7'

export type Account = {
  id: string
  accountId?: number
  providerKey?: string
  authType?: string
  name: string
  address: string
  unread: number
  messageCount?: number
  status: string
  credentialState?: string
  lastError?: string
  accent: string
}

export type Attachment = {
  id?: number
  name: string
  size: string
  type: string
  disposition?: string
}

export type MessageFolderRole =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'trash'
  | 'junk'
  | 'archive'
  | 'all_mail'
  | 'important'
  | 'starred'
  | 'custom'

export type Message = {
  id: string
  messageId: number
  accountId: number
  folderId: number
  folderRole?: MessageFolderRole
  folderName?: string
  from: string
  fromAddress?: string
  to?: string
  cc?: string
  replyTo?: string
  messageRfc822Id?: string
  references?: string
  subject: string
  preview: string
  verificationCode?: string
  body: string[]
  html?: string
  bodyStatus: 'none' | 'loading' | 'ready' | 'error'
  bodyLoaded: boolean
  detailLoaded: boolean
  externalImagesBlocked?: boolean
  receivedAt?: string
  time: string
  dateLabel: string
  unread: boolean
  starred: boolean
  attachments: Attachment[]
}
