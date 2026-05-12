import type { getAccount } from '../db/repositories/account.repository'
import { readAccountPassword } from '../services/credential-store'
import { getMicrosoftAccessToken } from '../services/microsoft-oauth'

type ImapAccount = NonNullable<ReturnType<typeof getAccount>>
type ImapLoginSession = {
  login: (username: string, password: string) => Promise<void>
  authenticateXOAuth2: (username: string, accessToken: string) => Promise<void>
}

export async function authenticateImapSession(
  account: ImapAccount,
  session: ImapLoginSession
): Promise<void> {
  if (account.authType === 'oauth2') {
    await session.authenticateXOAuth2(
      account.email,
      await getMicrosoftAccessToken(account.accountId)
    )
    return
  }

  await session.login(account.email, readAccountPassword(account.accountId))
}
