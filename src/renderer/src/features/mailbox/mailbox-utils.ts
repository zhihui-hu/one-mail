import type { Account, MailFilterTag, Message } from '@renderer/components/mail/types'

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function shouldShowOutlookImapHelp(message: string, account?: Account | null): boolean {
  if (account?.providerKey && normalizeProviderKey(account.providerKey) !== 'outlook') return false
  return /IMAP OAuth 登录认证失败|AUTHENTICATE failed/i.test(message)
}

export function createOutlookHelpAccount(accountId: number, email: string): Account {
  return {
    id: String(accountId),
    accountId,
    providerKey: 'outlook',
    name: email,
    address: email,
    unread: 0,
    status: 'auth_error',
    accent: 'bg-muted-foreground'
  }
}

export function shouldEditCredential(message: string): boolean {
  return /凭据不存在|凭据格式无效|凭据解密失败|重新保存密码/.test(message)
}

export function shouldAutoLoadBody(message: Message): boolean {
  if (message.bodyLoaded) return false
  return message.bodyStatus !== 'error'
}

export function getNextSelectedAccountId(
  accounts: Account[],
  removedAccountId: string,
  currentAccountId: string
): string {
  if (accounts.length === 0) return ''
  if (
    currentAccountId !== removedAccountId &&
    accounts.some((account) => account.id === currentAccountId)
  ) {
    return currentAccountId
  }
  return accounts.find((account) => account.id === 'all')?.id ?? accounts[0]?.id ?? ''
}

export function decrementUnreadCount(accounts: Account[], accountId: number): Account[] {
  return accounts.map((account) => {
    if (account.id !== 'all' && account.accountId !== accountId) return account
    return {
      ...account,
      unread: Math.max(0, account.unread - 1)
    }
  })
}

export function mergeMessagesById(current: Message[], nextMessages: Message[]): Message[] {
  const existingIds = new Set(current.map((message) => message.id))
  const uniqueNextMessages = nextMessages.filter((message) => !existingIds.has(message.id))
  return [...current, ...uniqueNextMessages]
}

export function getMessageListScopeKey(
  accountId: string,
  filters: MailFilterTag[],
  searchKeyword: string
): string {
  return `${accountId}:${[...filters].sort().join(',')}:${searchKeyword.trim()}`
}

export function getFallbackAccount(): Account {
  return {
    id: '',
    name: '暂无账号',
    address: '',
    unread: 0,
    messageCount: 0,
    status: 'empty',
    accent: 'bg-primary'
  }
}

function normalizeProviderKey(providerKey: string): string {
  const normalized = providerKey.toLowerCase()
  if (normalized.includes('outlook') || normalized.includes('microsoft')) return 'outlook'
  return normalized
}
