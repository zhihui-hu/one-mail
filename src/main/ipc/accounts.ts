import { BrowserWindow, ipcMain } from 'electron'
import {
  createAccount,
  disableAccount,
  getAccount,
  listAccounts,
  removeAccount,
  updateAccount
} from '../db/repositories/account.repository'
import { testImapConnection } from '../services/imap-connection-test'
import { refreshMailboxWatchers } from '../services/mailbox-watch'
import type { AccountCreateInput, AccountCreatedEvent, AccountUpdateInput } from './types'
import { saveAccountPassword, readAccountPassword } from '../services/credential-store'
import { authorizeMicrosoftAccount, saveMicrosoftAuthorization } from '../services/microsoft-oauth'
import { closeAddAccountWindow, openAddAccountWindow } from '../services/add-account-window'

export function registerAccountIpc(): void {
  ipcMain.handle('accounts/list', () => listAccounts())
  ipcMain.handle('accounts/openAddWindow', () => {
    openAddAccountWindow()
    return true
  })
  ipcMain.handle('accounts/closeAddWindow', () => {
    closeAddAccountWindow()
    return true
  })
  ipcMain.handle('accounts/create', async (_event, input: AccountCreateInput) => {
    let nextInput = input
    let oauthToken: Awaited<ReturnType<typeof authorizeMicrosoftAccount>>['token'] | undefined

    if (input.authType === 'oauth2') {
      const authorization = await authorizeMicrosoftAccount(input.oauthAuthorizationMode)
      oauthToken = authorization.token
      nextInput = {
        ...input,
        email: authorization.email
      }
    } else {
      await testImapConnection(input)
    }
    let account: ReturnType<typeof createAccount> | null = null

    try {
      account = createAccount(nextInput)
      if (nextInput.authType === 'oauth2') {
        if (!oauthToken) throw new Error('Microsoft OAuth 授权结果无效。')
        saveMicrosoftAuthorization(account.accountId, oauthToken)
      } else {
        saveAccountPassword(account.accountId, nextInput)
      }
      const savedAccount = getAccount(account.accountId) ?? account
      refreshMailboxWatchers()
      broadcastAccountCreated(savedAccount)
      return savedAccount
    } catch (error) {
      if (account) {
        removeAccount(account.accountId)
      }
      throw error
    }
  })
  ipcMain.handle('accounts/update', async (_event, input: AccountUpdateInput) => {
    const current = getAccount(input.accountId)
    if (!current) {
      throw new Error(`Account not found: ${input.accountId}`)
    }

    if (current.authType === 'oauth2' || input.authType === 'oauth2') {
      const account = updateAccount(normalizeOAuthAccountUpdate(input, current))
      refreshMailboxWatchers()
      return account
    }

    const password = input.password ?? readAccountPassword(input.accountId)
    const connectionInput: AccountCreateInput = {
      providerKey: input.providerKey ?? current.providerKey,
      email: current.email,
      password,
      accountLabel: input.accountLabel ?? current.accountLabel,
      authType: input.authType ?? current.authType,
      imapHost: input.imapHost ?? current.imapHost,
      imapPort: input.imapPort ?? current.imapPort,
      imapSecurity: input.imapSecurity ?? current.imapSecurity
    }
    await testImapConnection(connectionInput)

    const account = updateAccount(input)
    if (input.password) {
      saveAccountPassword(account.accountId, connectionInput)
    }
    refreshMailboxWatchers()
    return account
  })
  ipcMain.handle('accounts/reauthorize', async (_event, accountId: number) => {
    const current = getAccount(accountId)
    if (!current) {
      throw new Error(`Account not found: ${accountId}`)
    }
    if (current.authType !== 'oauth2') {
      throw new Error('只有 Microsoft OAuth 账号需要重新授权。')
    }

    const authorization = await authorizeMicrosoftAccount()
    if (authorization.email.toLowerCase() !== current.email.toLowerCase()) {
      throw new Error(`请使用 ${current.email} 完成授权。`)
    }

    saveMicrosoftAuthorization(current.accountId, authorization.token)
    const account = getAccount(current.accountId) ?? current
    refreshMailboxWatchers()
    return account
  })
  ipcMain.handle('accounts/disable', (_event, accountId: number) => {
    const account = disableAccount(accountId)
    refreshMailboxWatchers()
    return account
  })
  ipcMain.handle('accounts/remove', (_event, accountId: number) => {
    const removed = removeAccount(accountId)
    refreshMailboxWatchers()
    return removed
  })
}

function normalizeOAuthAccountUpdate(
  input: AccountUpdateInput,
  current: NonNullable<ReturnType<typeof getAccount>>
): AccountUpdateInput {
  if (
    input.password ||
    (input.authType && input.authType !== current.authType) ||
    (input.providerKey && input.providerKey !== current.providerKey) ||
    (input.imapHost && input.imapHost !== current.imapHost) ||
    (input.imapPort && input.imapPort !== current.imapPort) ||
    (input.imapSecurity && input.imapSecurity !== current.imapSecurity)
  ) {
    throw new Error('OAuth 账号只支持修改别名和同步开关；如需重新授权，请删除后重新添加。')
  }

  return {
    accountId: input.accountId,
    accountLabel: input.accountLabel,
    displayName: input.displayName,
    syncEnabled: input.syncEnabled
  }
}

function broadcastAccountCreated(account: AccountCreatedEvent['account']): void {
  const payload: AccountCreatedEvent = {
    account,
    requestedSync: true
  }

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('accounts/created', payload)
    }
  }
}
