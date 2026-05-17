import type { Account } from '@renderer/components/mail/types'
import type { TranslationKey } from '@renderer/lib/i18n'

export type AccountWarningAction = 'edit' | 'retry' | 'delete' | 'reauthorize'

export type AccountWarningInfo = {
  label: string
  title: string
  message: string
  tooltip: string
  primaryAction: AccountWarningAction
  primaryLabel: string
  secondaryAction?: AccountWarningAction
  secondaryLabel?: string
  steps: string[]
}

const CREDENTIAL_WARNING_STATES = new Set(['pending', 'invalid', 'expired', 'revoked'])

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string

export function getAccountWarning(account: Account, t: Translate): AccountWarningInfo | null {
  if (!account.accountId) return null

  const status = account.status?.toLowerCase()
  const credentialState = account.credentialState?.toLowerCase()
  const lastError = account.lastError?.trim()
  const isOAuthAccount = account.authType === 'oauth2'
  const needsOAuthReauthorization =
    isOAuthAccount && lastError ? isMicrosoftReauthorizationError(lastError) : false

  if (status === 'syncing') return null

  if (
    status === 'auth_error' ||
    CREDENTIAL_WARNING_STATES.has(credentialState ?? '') ||
    needsOAuthReauthorization
  ) {
    const message = getCredentialWarningMessage(isOAuthAccount, t, lastError)
    const primaryAction = isOAuthAccount ? 'reauthorize' : 'edit'

    return withTooltip(t, {
      label: t('account.warning.label'),
      title: isOAuthAccount
        ? t('account.warning.reauthorizeTitle')
        : t('account.warning.credentialTitle'),
      message,
      primaryAction,
      primaryLabel: isOAuthAccount
        ? t('account.warning.primaryReauthorize')
        : t('account.warning.primaryEditCredential'),
      secondaryAction: 'retry',
      secondaryLabel: t('account.warning.resync'),
      steps: isOAuthAccount
        ? [
            t('account.warning.oauthStep1'),
            t('account.warning.oauthStep2'),
            t('account.warning.oauthStep3')
          ]
        : [
            t('account.warning.credentialStep1'),
            t('account.warning.credentialStep2'),
            t('account.warning.credentialStep3')
          ]
    })
  }

  if (status === 'network_error') {
    return withTooltip(t, {
      label: t('account.warning.label'),
      title: t('account.warning.networkTitle'),
      message: lastError || t('account.warning.networkMessage'),
      primaryAction: 'retry',
      primaryLabel: t('account.warning.resync'),
      secondaryAction: 'edit',
      secondaryLabel: t('account.warning.checkConfig'),
      steps: [
        t('account.warning.networkStep1'),
        t('account.warning.networkStep2'),
        t('account.warning.networkStep3')
      ]
    })
  }

  if (status === 'sync_error') {
    return withTooltip(t, {
      label: t('account.warning.label'),
      title: t('account.warning.syncTitle'),
      message: lastError || t('account.warning.syncMessage'),
      primaryAction: 'retry',
      primaryLabel: t('account.warning.resync'),
      secondaryAction: 'edit',
      secondaryLabel: t('account.warning.checkConfig'),
      steps: [
        t('account.warning.syncStep1'),
        t('account.warning.syncStep2'),
        t('account.warning.syncStep3')
      ]
    })
  }

  if (lastError) {
    return withTooltip(t, {
      label: t('account.warning.label'),
      title: t('account.warning.genericTitle'),
      message: lastError,
      primaryAction: 'retry',
      primaryLabel: t('account.warning.resync'),
      secondaryAction: 'edit',
      secondaryLabel: t('account.warning.editAccount'),
      steps: [t('account.warning.genericStep1'), t('account.warning.genericStep2')]
    })
  }

  return null
}

function getCredentialWarningMessage(
  isOAuthAccount: boolean,
  t: Translate,
  lastError?: string
): string {
  if (!isOAuthAccount) return lastError || t('account.warning.credentialMessage')

  if (!lastError) return t('account.warning.oauthMissingMessage')

  if (isMicrosoftReauthorizationError(lastError)) {
    return t('account.warning.oauthScopeMessage')
  }

  return lastError
}

function isMicrosoftReauthorizationError(message: string): boolean {
  return /AADSTS70000|scopes requested are unauthorized or expired|grant the client application access|refresh token 不存在|重新登录 Outlook|OAuth 凭据|Microsoft OAuth 未授予|access token 不是 Outlook IMAP|OAuth access token/i.test(
    message
  )
}

function withTooltip(
  t: Translate,
  warning: Omit<AccountWarningInfo, 'tooltip'>
): AccountWarningInfo {
  return {
    ...warning,
    tooltip: t('account.warning.tooltip', {
      title: warning.title,
      message: warning.message
    })
  }
}
