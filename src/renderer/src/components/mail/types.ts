export type MailFilterTag = 'unread' | 'attachments' | 'starred' | 'today'

export type Account = {
  id: string
  accountId?: number
  providerKey?: string
  name: string
  address: string
  unread: number
  messageCount?: number
  status: string
  credentialState?: string
  accent: string
}

export type Attachment = {
  id?: number
  name: string
  size: string
  type: string
  disposition?: string
}

export type Message = {
  id: string
  messageId: number
  accountId: number
  folderId: number
  from: string
  fromAddress?: string
  to?: string
  cc?: string
  subject: string
  preview: string
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
