import type { getAccount } from '../db/repositories/account.repository'
import { readAccountPassword } from '../services/credential-store'
import {
  getMicrosoftAccessToken,
  refreshMicrosoftAccessToken,
  type MicrosoftAccessTokenResult
} from '../services/microsoft-oauth'

type ImapAccount = NonNullable<ReturnType<typeof getAccount>>
type ImapLoginSession = {
  identifyClient: () => Promise<void>
  login: (username: string, password: string) => Promise<void>
  authenticateXOAuth2: (username: string, accessToken: string) => Promise<void>
}

export async function authenticateImapSession(
  account: ImapAccount,
  session: ImapLoginSession
): Promise<void> {
  if (account.authType === 'oauth2') {
    await authenticateXOAuth2WithRefreshRetry(account, session)
    await session.identifyClient()
    return
  }

  await session.login(account.email, readAccountPassword(account.accountId))
  await session.identifyClient()
}

async function authenticateXOAuth2WithRefreshRetry(
  account: ImapAccount,
  session: ImapLoginSession
): Promise<void> {
  const token = await getMicrosoftAccessToken(account.accountId)
  try {
    await authenticateWithMicrosoftToken(account, session, token)
  } catch (error) {
    if (!isXOAuth2AuthError(error)) throw error

    await authenticateWithMicrosoftToken(
      account,
      session,
      await refreshMicrosoftAccessToken(account.accountId)
    )
  }
}

async function authenticateWithMicrosoftToken(
  account: ImapAccount,
  session: ImapLoginSession,
  token: MicrosoftAccessTokenResult
): Promise<void> {
  const usernames = uniqueStrings([account.email, ...token.loginHints])
  let lastError: unknown

  for (const username of usernames) {
    try {
      await session.authenticateXOAuth2(username, token.accessToken)
      return
    } catch (error) {
      if (!isXOAuth2AuthError(error)) throw error
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('IMAP OAuth 登录认证失败。')
}

function isXOAuth2AuthError(error: unknown): boolean {
  return error instanceof Error && /AUTHENTICATE failed|OAuth 登录认证失败/i.test(error.message)
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(isNonEmptyString)))
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0
}
