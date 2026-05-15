export function toImapConnectionError(error: Error): Error {
  const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
  const message = error.message

  if (code === 'ENOTFOUND') {
    return new Error('找不到 IMAP 服务器，请检查服务器地址。')
  }

  if (code === 'ECONNREFUSED') {
    return new Error('IMAP 服务器拒绝连接，请检查端口和安全模式。')
  }

  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
    return new Error('连接 IMAP 服务器超时，请检查网络或服务器地址。')
  }

  if (code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
    return new Error('IMAP 服务器证书无效，无法建立安全连接。')
  }

  if (
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    /^ERR_SSL_/i.test(code) ||
    /SSL|TLS|handshake|BAD_DECRYPT|bad decrypt/i.test(message)
  ) {
    return new Error('IMAP 安全连接失败，请检查网络代理、SSL/TLS 拦截或服务器安全模式后重试。')
  }

  return new Error(`IMAP 连接失败：${message}`)
}

export function sanitizeImapResponse(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

export function isImapAuthErrorMessage(message: string): boolean {
  return /凭据不存在|凭据格式无效|凭据解密失败|重新保存密码|IMAP 登录认证失败|AUTHENTICATE failed|AUTHENTICATIONFAILED|Invalid credentials|OAuth 凭据|refresh token 不存在|重新登录 Outlook|AADSTS70000|scopes requested are unauthorized or expired|grant the client application access|Microsoft OAuth 未授予|access token 不是 Outlook IMAP/i.test(
    message
  )
}

export function isImapNetworkErrorMessage(message: string): boolean {
  return /IMAP 安全连接失败|连接 IMAP 服务器超时|找不到 IMAP 服务器|拒绝连接|证书无效|网络|服务器地址|ECONNRESET|EPIPE|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|SSL|TLS|handshake|BAD_DECRYPT|bad decrypt/i.test(
    message
  )
}
