import { Socket, connect as connectTcp } from 'node:net'
import { TLSSocket, connect as connectTls } from 'node:tls'
import type { AccountCreateInput } from '../ipc/types'
import { toImapConnectionError } from '../mail/imap-errors'

const CONNECTION_TIMEOUT_MS = 10000
const OAUTH_IMAP_AUTH_RETRY_DELAYS_MS = [1200, 2500, 5000]

type TestSocket = Socket | TLSSocket
const CLIENT_ID = {
  name: 'OneMail',
  version: '1.0.0',
  vendor: 'OneMail',
  'support-email': 'support-onemail@huzhihui.com'
}

export async function testImapConnection(input: AccountCreateInput): Promise<void> {
  const email = input.email
  const password = normalizeInputPassword(input)
  if (!email) {
    throw new Error('请输入邮箱地址。')
  }

  if (!password) {
    throw new Error('请输入邮箱授权码或密码。')
  }

  if (input.imapSecurity === 'ssl_tls') {
    await testTlsConnection(input, email, password)
    return
  }

  await testPlainConnection(input, email, password)
}

function normalizeInputPassword(input: AccountCreateInput): string {
  const password = input.password?.trim() ?? ''
  return input.authType === 'app_password' ? password.replace(/\s+/g, '') : password
}

export async function testImapOAuthConnection(
  input: AccountCreateInput,
  accessToken: string
): Promise<void> {
  const email = input.email
  if (!email) {
    throw new Error('Microsoft OAuth 未返回邮箱地址。')
  }

  for (let attempt = 0; attempt <= OAUTH_IMAP_AUTH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      if (input.imapSecurity === 'ssl_tls') {
        await testOAuthTlsConnection(input, email, accessToken)
      } else {
        await testOAuthPlainConnection(input, email, accessToken)
      }
      return
    } catch (error) {
      if (attempt >= OAUTH_IMAP_AUTH_RETRY_DELAYS_MS.length || !isOAuthImapAuthError(error)) {
        throw error
      }

      await wait(OAUTH_IMAP_AUTH_RETRY_DELAYS_MS[attempt])
    }
  }
}

async function testTlsConnection(
  input: AccountCreateInput,
  email: string,
  password: string
): Promise<void> {
  const socket = connectTls({
    host: input.imapHost,
    port: input.imapPort,
    servername: input.imapHost,
    rejectUnauthorized: true
  })

  try {
    await waitForTlsConnect(socket)
    await waitForImapGreeting(socket)
    await testLogin(socket, input, email, password)
  } finally {
    socket.destroy()
  }
}

async function testOAuthTlsConnection(
  input: AccountCreateInput,
  email: string,
  accessToken: string
): Promise<void> {
  const socket = connectTls({
    host: input.imapHost,
    port: input.imapPort,
    servername: input.imapHost,
    rejectUnauthorized: true
  })

  try {
    await waitForTlsConnect(socket)
    await waitForImapGreeting(socket)
    await testOAuthLogin(socket, email, accessToken)
  } finally {
    socket.destroy()
  }
}

async function testPlainConnection(
  input: AccountCreateInput,
  email: string,
  password: string
): Promise<void> {
  let socket: TestSocket = connectTcp({
    host: input.imapHost,
    port: input.imapPort
  })

  try {
    await waitForTcpConnect(socket)
    await waitForImapGreeting(socket)

    if (input.imapSecurity === 'starttls') {
      await writeLine(socket, 'A001 STARTTLS')
      await waitForTaggedOk(socket, 'A001', 'STARTTLS')
      socket = await upgradeToTls(socket, input.imapHost)
    }
    await testLogin(socket, input, email, password)
  } finally {
    socket.destroy()
  }
}

async function testOAuthPlainConnection(
  input: AccountCreateInput,
  email: string,
  accessToken: string
): Promise<void> {
  let socket: TestSocket = connectTcp({
    host: input.imapHost,
    port: input.imapPort
  })

  try {
    await waitForTcpConnect(socket)
    await waitForImapGreeting(socket)

    if (input.imapSecurity === 'starttls') {
      await writeLine(socket, 'A001 STARTTLS')
      await waitForTaggedOk(socket, 'A001', 'STARTTLS')
      socket = await upgradeToTls(socket, input.imapHost)
    }
    await testOAuthLogin(socket, email, accessToken)
  } finally {
    socket.destroy()
  }
}

async function testLogin(
  socket: TestSocket,
  input: AccountCreateInput,
  username: string,
  password: string
): Promise<void> {
  await writeLine(socket, `A002 LOGIN ${quoteAtom(username)} ${quoteAtom(password)}`)
  await waitForTaggedOk(socket, 'A002', '登录认证', input)
  await identifyClient(socket, 'A003')
  await writeLine(socket, 'A004 EXAMINE "INBOX"')
  await waitForTaggedOk(socket, 'A004', '收件箱访问')
  await writeLine(socket, 'A005 LOGOUT')
}

async function testOAuthLogin(
  socket: TestSocket,
  username: string,
  accessToken: string
): Promise<void> {
  await writeLine(
    socket,
    `A002 AUTHENTICATE XOAUTH2 ${formatXOAuth2Payload(username, accessToken)}`
  )
  await waitForTaggedOk(socket, 'A002', 'OAuth 登录认证')
  await identifyClient(socket, 'A003')
  await writeLine(socket, 'A004 EXAMINE "INBOX"')
  await waitForTaggedOk(socket, 'A004', '收件箱访问')
  await writeLine(socket, 'A005 LOGOUT')
}

async function identifyClient(socket: TestSocket, tag: string): Promise<void> {
  await writeLine(socket, `${tag} ${formatImapIdCommand()}`)
  await waitForTaggedOk(socket, tag, '客户端身份确认').catch(() => undefined)
}

function upgradeToTls(socket: Socket, servername: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = connectTls({
      socket,
      servername,
      rejectUnauthorized: true
    })

    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('STARTTLS 握手超时，请检查服务器安全模式。'))
    }, CONNECTION_TIMEOUT_MS)

    function cleanup(): void {
      clearTimeout(timeout)
      tlsSocket.off('secureConnect', handleSecureConnect)
      tlsSocket.off('error', handleError)
    }

    function handleSecureConnect(): void {
      cleanup()
      resolve(tlsSocket)
    }

    function handleError(error: Error): void {
      cleanup()
      reject(toImapConnectionError(error))
    }

    tlsSocket.once('secureConnect', handleSecureConnect)
    tlsSocket.once('error', handleError)
  })
}

function waitForTcpConnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('连接 IMAP 服务器超时，请检查服务器地址和端口。'))
    }, CONNECTION_TIMEOUT_MS)

    function cleanup(): void {
      clearTimeout(timeout)
      socket.off('connect', handleConnect)
      socket.off('error', handleError)
    }

    function handleConnect(): void {
      cleanup()
      resolve()
    }

    function handleError(error: Error): void {
      cleanup()
      reject(toImapConnectionError(error))
    }

    socket.once('connect', handleConnect)
    socket.once('error', handleError)
  })
}

function waitForTlsConnect(socket: TLSSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('连接 IMAP 服务器超时，请检查服务器地址和端口。'))
    }, CONNECTION_TIMEOUT_MS)

    function cleanup(): void {
      clearTimeout(timeout)
      socket.off('secureConnect', handleSecureConnect)
      socket.off('error', handleError)
    }

    function handleSecureConnect(): void {
      cleanup()
      resolve()
    }

    function handleError(error: Error): void {
      cleanup()
      reject(toImapConnectionError(error))
    }

    socket.once('secureConnect', handleSecureConnect)
    socket.once('error', handleError)
  })
}

function waitForImapGreeting(socket: TestSocket): Promise<void> {
  return waitForLine(socket, (line) => {
    if (/^\*\s+OK\b/i.test(line)) return true
    if (/^\*\s+(NO|BAD|BYE)\b/i.test(line)) {
      throw new Error(`IMAP 服务器拒绝连接：${line}`)
    }
    return false
  })
}

function waitForTaggedOk(
  socket: TestSocket,
  tag: string,
  action: string,
  input?: AccountCreateInput
): Promise<void> {
  return waitForLine(socket, (line) => {
    if (new RegExp(`^${tag}\\s+OK\\b`, 'i').test(line)) return true
    if (new RegExp(`^${tag}\\s+(NO|BAD)\\b`, 'i').test(line)) {
      throw new Error(formatImapActionError(action, line, input))
    }
    return false
  })
}

function waitForLine(socket: TestSocket, isDone: (line: string) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('IMAP 服务器未返回有效响应。'))
    }, CONNECTION_TIMEOUT_MS)

    function cleanup(): void {
      clearTimeout(timeout)
      socket.off('data', handleData)
      socket.off('error', handleError)
      socket.off('close', handleClose)
    }

    function handleData(chunk: Buffer): void {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''

      try {
        for (const line of lines) {
          if (isDone(line.trim())) {
            cleanup()
            resolve()
            return
          }
        }
      } catch (error) {
        cleanup()
        reject(error instanceof Error ? error : new Error('IMAP 响应解析失败。'))
      }
    }

    function handleError(error: Error): void {
      cleanup()
      reject(toImapConnectionError(error))
    }

    function handleClose(): void {
      cleanup()
      reject(new Error('IMAP 连接已断开。'))
    }

    socket.on('data', handleData)
    socket.once('error', handleError)
    socket.once('close', handleClose)
  })
}

function writeLine(socket: Socket, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(`${line}\r\n`, (error) => {
      if (error) {
        reject(toImapConnectionError(error))
        return
      }

      resolve()
    })
  })
}

function quoteAtom(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function formatXOAuth2Payload(username: string, accessToken: string): string {
  return Buffer.from(`user=${username}\x01auth=Bearer ${accessToken}\x01\x01`, 'utf8').toString(
    'base64'
  )
}

function formatImapIdCommand(): string {
  const values = Object.entries(CLIENT_ID).flatMap(([key, value]) => [key, value])
  return `ID (${values.map(quoteAtom).join(' ')})`
}

function sanitizeImapResponse(value: string): string {
  if (/Unsafe Login/i.test(value)) {
    return '网易邮箱要求客户端发送 IMAP ID 身份信息，请重试或确认已开启 IMAP/SMTP 服务并使用授权码。'
  }

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

function formatImapActionError(
  action: string,
  line: string,
  input?: AccountCreateInput
): string {
  if (action === '登录认证' && input && isNetease163Input(input)) {
    return [
      '163 邮箱登录认证失败：网易拒绝了当前账号或授权码。',
      '请确认已在网页版邮箱的“设置 > POP3/SMTP/IMAP”中开启 IMAP/SMTP 服务，并使用“新增授权密码/客户端授权码”作为密码，不要使用网页登录密码。',
      '账号请填写完整邮箱地址；如果授权码忘记或不确定，请新增/重置后再试。',
      `服务器响应：${sanitizeImapResponse(line)}`
    ].join(' ')
  }

  if (action === 'OAuth 登录认证' && /AUTHENTICATE failed/i.test(line)) {
    return [
      'IMAP OAuth 登录认证失败：Outlook 拒绝了当前 Microsoft access token。',
      '请确认该 Microsoft 账号/组织已允许 IMAP，并且授权页已同意 Outlook IMAP 权限；如果刚完成首次授权，请稍后重试或删除该账号后重新添加。',
      `服务器响应：${sanitizeImapResponse(line)}`
    ].join(' ')
  }

  if (action === '登录认证' && /AUTHENTICATIONFAILED|Invalid credentials/i.test(line)) {
    return [
      'IMAP 登录认证失败：Gmail 拒绝了当前凭据。',
      '请使用 Google 账号的 16 位应用密码，不要使用 Google 登录密码；如果复制的应用密码带空格，系统会自动去掉空格后再登录。',
      `服务器响应：${sanitizeImapResponse(line)}`
    ].join(' ')
  }

  return `IMAP ${action}失败：${sanitizeImapResponse(line)}`
}

function isNetease163Input(input: AccountCreateInput): boolean {
  return (
    input.providerKey === '163' ||
    input.imapHost.toLowerCase() === 'imap.163.com' ||
    input.email?.toLowerCase().endsWith('@163.com') === true
  )
}

function isOAuthImapAuthError(error: unknown): boolean {
  return error instanceof Error && /IMAP OAuth 登录认证失败/i.test(error.message)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
