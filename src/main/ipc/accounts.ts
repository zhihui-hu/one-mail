import { ipcMain } from 'electron'
import {
  createAccount,
  disableAccount,
  getAccount,
  listAccounts,
  removeAccount,
  updateAccount
} from '../db/repositories/account.repository'
import { testImapConnection, testImapOAuthConnection } from '../services/imap-connection-test'
import { refreshMailboxWatchers } from '../services/mailbox-watch'
import type { AccountCreateInput, AccountUpdateInput } from './types'
import { saveAccountPassword, readAccountPassword } from '../services/credential-store'
import {
  authorizeMicrosoftAccount,
  getMicrosoftAccessToken,
  saveMicrosoftAuthorization
} from '../services/microsoft-oauth'

export function registerAccountIpc(): void {
  ipcMain.handle('accounts/list', () => listAccounts())
  ipcMain.handle('accounts/create', async (_event, input: AccountCreateInput) => {
    let nextInput = input
    let oauthToken: Awaited<ReturnType<typeof authorizeMicrosoftAccount>>['token'] | undefined

    if (input.authType === 'oauth2') {
      const authorization = await authorizeMicrosoftAccount()
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
        await testImapOAuthConnection(nextInput, await getMicrosoftAccessToken(account.accountId))
      } else {
        saveAccountPassword(account.accountId, nextInput)
      }
      const savedAccount = getAccount(account.accountId) ?? account
      refreshMailboxWatchers()
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
      throw new Error('OAuth 账号暂不支持在编辑弹窗中更新，请删除后重新使用 Microsoft 登录。')
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
