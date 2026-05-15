import type { Account } from '@renderer/components/mail/types'

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

export function getAccountWarning(account: Account): AccountWarningInfo | null {
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
    const message = getCredentialWarningMessage(isOAuthAccount, lastError)
    const primaryAction = isOAuthAccount ? 'reauthorize' : 'edit'

    return withTooltip({
      label: '异常',
      title: isOAuthAccount ? '需要重新授权' : '账号凭据异常',
      message,
      primaryAction,
      primaryLabel: isOAuthAccount ? '重新授权' : '编辑凭据',
      secondaryAction: 'retry',
      secondaryLabel: '重新同步',
      steps: isOAuthAccount
        ? [
            'Microsoft 授权已过期、被撤销，或缺少 Outlook IMAP 权限。',
            '点击重新授权，并在 Microsoft 授权页同意 OneMail 访问邮箱。',
            '授权完成后 OneMail 会保存新的 token 并重新同步该账号。'
          ]
        : [
            '确认邮箱密码或客户端授权码仍然有效。',
            '重新保存凭据后会测试 IMAP 连接。',
            '保存成功后再同步该账号。'
          ]
    })
  }

  if (status === 'network_error') {
    return withTooltip({
      label: '异常',
      title: '网络连接异常',
      message: lastError || '暂时无法连接到邮箱服务器。',
      primaryAction: 'retry',
      primaryLabel: '重新同步',
      secondaryAction: 'edit',
      secondaryLabel: '检查配置',
      steps: [
        '确认当前网络可以访问邮箱服务器。',
        '检查代理、VPN、防火墙或公司网络限制。',
        '网络恢复后重新同步该账号。'
      ]
    })
  }

  if (status === 'sync_error') {
    return withTooltip({
      label: '异常',
      title: '同步异常',
      message: lastError || '同步邮件时遇到错误。',
      primaryAction: 'retry',
      primaryLabel: '重新同步',
      secondaryAction: 'edit',
      secondaryLabel: '检查配置',
      steps: [
        '先重新同步一次，排除临时服务器错误。',
        '如果持续失败，检查 IMAP 主机、端口和加密方式。',
        '必要时重新保存密码或授权码。'
      ]
    })
  }

  if (lastError) {
    return withTooltip({
      label: '异常',
      title: '账号异常',
      message: lastError,
      primaryAction: 'retry',
      primaryLabel: '重新同步',
      secondaryAction: 'edit',
      secondaryLabel: '编辑账号',
      steps: ['重新同步该账号。', '如果问题仍然存在，检查账号配置和凭据。']
    })
  }

  return null
}

function getCredentialWarningMessage(isOAuthAccount: boolean, lastError?: string): string {
  if (!isOAuthAccount) return lastError || '账号密码或客户端授权码需要重新保存。'

  if (!lastError) return 'Microsoft 授权已失效，需要重新登录并授权 Outlook IMAP 权限。'

  if (isMicrosoftReauthorizationError(lastError)) {
    return 'Microsoft 授权已过期或缺少 Outlook IMAP 权限，需要重新登录并授权。'
  }

  return lastError
}

function isMicrosoftReauthorizationError(message: string): boolean {
  return /AADSTS70000|scopes requested are unauthorized or expired|grant the client application access|refresh token 不存在|重新登录 Outlook|OAuth 凭据|Microsoft OAuth 未授予|access token 不是 Outlook IMAP|OAuth access token/i.test(
    message
  )
}

function withTooltip(warning: Omit<AccountWarningInfo, 'tooltip'>): AccountWarningInfo {
  return {
    ...warning,
    tooltip: `${warning.title}：${warning.message} 点击查看解决办法。`
  }
}
