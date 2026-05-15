import { Socket, connect as connectTcp } from 'node:net'
import { TLSSocket, connect as connectTls } from 'node:tls'
import type { getAccount } from '../db/repositories/account.repository'
import { sanitizeImapResponse, toImapConnectionError } from './imap-errors'

type TestSocket = Socket | TLSSocket
type ImapAccount = NonNullable<ReturnType<typeof getAccount>>

const CONNECTION_TIMEOUT_MS = 15000
const BODY_FETCH_TIMEOUT_MS = 60000
export type ImapAppendOptions = {
  flags?: string[]
  internalDate?: Date | string
}

export class SimpleImapSession {
  private tagIndex = 1
  private socketError: Error | undefined
  private readonly socketErrorGuard = (error: Error): void => {
    this.socketError = toImapConnectionError(error)
  }

  private constructor(
    private socket: TestSocket,
    private readonly tagPrefix: string
  ) {
    this.watchSocketErrors(socket)
  }

  static async connect(account: ImapAccount, tagPrefix = 'A'): Promise<SimpleImapSession> {
    const socket =
      account.imapSecurity === 'ssl_tls'
        ? connectTls({
            host: account.imapHost,
            port: account.imapPort,
            servername: account.imapHost,
            rejectUnauthorized: true
          })
        : connectTcp({
            host: account.imapHost,
            port: account.imapPort
          })

    const session = new SimpleImapSession(socket, tagPrefix)
    await session.waitForGreeting()

    if (account.imapSecurity === 'starttls' && socket instanceof Socket) {
      await session.command('STARTTLS')
      session.replaceSocket(await upgradeToTls(socket, account.imapHost))
    }

    return session
  }

  async login(username: string, password: string): Promise<void> {
    await this.command(`LOGIN ${quoteAtom(username)} ${quoteAtom(password)}`)
  }

  async authenticateXOAuth2(username: string, accessToken: string): Promise<void> {
    await this.command(`AUTHENTICATE XOAUTH2 ${formatXOAuth2Payload(username, accessToken)}`)
  }

  async identifyClient(): Promise<void> {
    await this.command(formatImapIdCommand()).catch(() => undefined)
  }

  async capability(): Promise<Set<string>> {
    const response = await this.command('CAPABILITY')
    const capabilities = new Set<string>()

    for (const line of response.split(/\r?\n/)) {
      const match = /^\*\s+CAPABILITY\s+(.+)$/i.exec(line.trim())
      if (!match?.[1]) continue

      for (const item of match[1].trim().split(/\s+/)) {
        if (item) capabilities.add(item.toUpperCase())
      }
    }

    return capabilities
  }

  async selectInbox(): Promise<void> {
    await this.selectMailbox('INBOX')
  }

  async selectMailbox(path: string): Promise<void> {
    await this.command(`SELECT ${quoteAtom(path)}`)
  }

  async fetchRawMessage(uid: number): Promise<string> {
    const response = await this.command(`UID FETCH ${uid} (BODY.PEEK[])`, BODY_FETCH_TIMEOUT_MS)
    return extractRawMessageLiteral(response)
  }

  async appendMessage(
    mailboxPath: string,
    rawMessage: string,
    optionsOrFlags: ImapAppendOptions | string[] = {}
  ): Promise<void> {
    const options = Array.isArray(optionsOrFlags) ? { flags: optionsOrFlags } : optionsOrFlags
    const flags = formatAppendFlags(options.flags)
    const internalDate = formatAppendInternalDate(options.internalDate)
    const literal = Buffer.from(rawMessage, 'utf8')
    const tag = `${this.tagPrefix}${String(this.tagIndex++).padStart(4, '0')}`
    const command = ['APPEND', quoteAtom(mailboxPath), flags, internalDate, `{${literal.byteLength}}`]
      .filter(Boolean)
      .join(' ')

    await this.literalCommand(
      tag,
      command,
      literal,
      BODY_FETCH_TIMEOUT_MS
    )
  }

  async uidMove(uid: number, destinationMailbox: string): Promise<void> {
    assertValidUid(uid)
    await this.command(`UID MOVE ${uid} ${quoteAtom(destinationMailbox)}`)
  }

  async uidCopy(uid: number, destinationMailbox: string): Promise<void> {
    assertValidUid(uid)
    await this.command(`UID COPY ${uid} ${quoteAtom(destinationMailbox)}`)
  }

  async setSeenFlag(uid: number, isRead: boolean): Promise<void> {
    assertValidUid(uid)
    const operation = isRead ? '+FLAGS.SILENT' : '-FLAGS.SILENT'
    await this.command(`UID STORE ${uid} ${operation} (\\Seen)`)
  }

  async setDeletedFlag(uid: number, isDeleted = true): Promise<void> {
    assertValidUid(uid)
    const operation = isDeleted ? '+FLAGS.SILENT' : '-FLAGS.SILENT'
    await this.command(`UID STORE ${uid} ${operation} (\\Deleted)`)
  }

  async setAnsweredFlag(uid: number, isAnswered = true): Promise<void> {
    assertValidUid(uid)
    const operation = isAnswered ? '+FLAGS.SILENT' : '-FLAGS.SILENT'
    await this.command(`UID STORE ${uid} ${operation} (\\Answered)`)
  }

  async expunge(): Promise<void> {
    await this.command('EXPUNGE')
  }

  async logout(): Promise<void> {
    try {
      await this.command('LOGOUT')
    } finally {
      this.socket.off('error', this.socketErrorGuard)
      this.socket.destroy()
    }
  }

  private async waitForGreeting(): Promise<void> {
    await waitForLine(this.socket, (line) => {
      if (/^\*\s+OK\b/i.test(line)) return true
      if (/^\*\s+(NO|BAD|BYE)\b/i.test(line)) {
        throw new Error(`IMAP 服务器拒绝连接：${line}`)
      }
      return false
    })
  }

  private async command(command: string, timeoutMs = CONNECTION_TIMEOUT_MS): Promise<string> {
    this.assertSocketHealthy()
    const tag = `${this.tagPrefix}${String(this.tagIndex++).padStart(4, '0')}`
    await writeLine(this.socket, `${tag} ${command}`)
    const response = await readUntilTagged(this.socket, tag, timeoutMs)
    const lastLine = response
      .trimEnd()
      .split(/\r?\n/)
      .findLast((line) => line.trimStart().startsWith(tag))

    if (!lastLine || !new RegExp(`^${tag}\\s+OK\\b`, 'i').test(lastLine.trimStart())) {
      throw new Error(`IMAP 命令失败：${sanitizeImapResponse(lastLine ?? command)}`)
    }

    return response
  }

  private async literalCommand(
    tag: string,
    command: string,
    literal: Buffer,
    timeoutMs = CONNECTION_TIMEOUT_MS
  ): Promise<string> {
    this.assertSocketHealthy()
    await writeLine(this.socket, `${tag} ${command}`)
    await waitForContinuation(this.socket)
    await writeRaw(this.socket, Buffer.concat([literal, Buffer.from('\r\n', 'utf8')]))
    const response = await readUntilTagged(this.socket, tag, timeoutMs)
    const lastLine = response
      .trimEnd()
      .split(/\r?\n/)
      .findLast((line) => line.trimStart().startsWith(tag))

    if (!lastLine || !new RegExp(`^${tag}\\s+OK\\b`, 'i').test(lastLine.trimStart())) {
      throw new Error(`IMAP 命令失败：${sanitizeImapResponse(lastLine ?? command)}`)
    }

    return response
  }

  private replaceSocket(socket: TestSocket): void {
    this.socket.off('error', this.socketErrorGuard)
    this.socket = socket
    this.socketError = undefined
    this.watchSocketErrors(socket)
  }

  private watchSocketErrors(socket: TestSocket): void {
    socket.on('error', this.socketErrorGuard)
  }

  private assertSocketHealthy(): void {
    if (this.socketError) throw this.socketError
  }
}

function extractRawMessageLiteral(response: string): string {
  const literalPattern = /BODY\[[^\]]*\](?:<\d+>)?\s+\{(\d+)\}\r?\n/i
  const match = literalPattern.exec(response)
  const byteLength = Number(match?.[1])
  if (!match || !Number.isInteger(byteLength) || byteLength < 0) return ''

  return sliceUtf8Literal(response, match.index + match[0].length, byteLength)
}

function sliceUtf8Literal(value: string, start: number, byteLength: number): string {
  let end = start
  let remainingBytes = byteLength

  while (end < value.length && remainingBytes > 0) {
    const codePoint = value.codePointAt(end)
    if (codePoint === undefined) break

    const char = String.fromCodePoint(codePoint)
    const charByteLength = Buffer.byteLength(char, 'utf8')
    if (charByteLength > remainingBytes) break

    remainingBytes -= charByteLength
    end += char.length
  }

  return value.slice(start, end)
}

const CLIENT_ID = {
  name: 'OneMail',
  version: '1.0.0',
  vendor: 'OneMail',
  'support-email': 'support@onemail.local'
}

function formatImapIdCommand(): string {
  const values = Object.entries(CLIENT_ID).flatMap(([key, value]) => [key, value])
  return `ID (${values.map(quoteAtom).join(' ')})`
}

function quoteAtom(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function assertValidUid(uid: number): void {
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error('邮件 UID 无效，无法执行 IMAP 操作。')
  }
}

function formatAppendFlags(flags?: string[]): string {
  if (!flags || flags.length === 0) return ''

  const normalized = flags
    .map((flag) => flag.trim())
    .filter(Boolean)
    .map((flag) => (flag.startsWith('\\') ? flag : `\\${flag}`))

  return normalized.length > 0 ? `(${normalized.join(' ')})` : ''
}

function formatAppendInternalDate(value?: Date | string): string {
  if (!value) return ''

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    date.getUTCMonth()
  ]
  const year = date.getUTCFullYear()
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const seconds = String(date.getUTCSeconds()).padStart(2, '0')

  return `"${day}-${month}-${year} ${hours}:${minutes}:${seconds} +0000"`
}

function formatXOAuth2Payload(username: string, accessToken: string): string {
  return Buffer.from(`user=${username}\x01auth=Bearer ${accessToken}\x01\x01`, 'utf8').toString(
    'base64'
  )
}

function upgradeToTls(socket: Socket, servername: string): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const tlsSocket = connectTls({ socket, servername, rejectUnauthorized: true })
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

function waitForLine(socket: TestSocket, isDone: (line: string) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('IMAP 服务器响应超时。'))
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

function readUntilTagged(
  socket: TestSocket,
  tag: string,
  timeoutMs = CONNECTION_TIMEOUT_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    let timeout = setTimeout(() => {
      cleanup()
      reject(new Error('IMAP 服务器响应超时。'))
    }, timeoutMs)

    function cleanup(): void {
      clearTimeout(timeout)
      socket.off('data', handleData)
      socket.off('error', handleError)
      socket.off('close', handleClose)
    }

    function resetTimeout(): void {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        cleanup()
        reject(new Error('IMAP 服务器响应超时。'))
      }, timeoutMs)
    }

    function handleData(chunk: Buffer): void {
      buffer += chunk.toString('utf8')

      if (new RegExp(`(^|\\r?\\n)${tag}\\s+(OK|NO|BAD)\\b`, 'i').test(buffer)) {
        cleanup()
        resolve(buffer)
        return
      }

      resetTimeout()
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

function writeLine(socket: TestSocket, line: string): Promise<void> {
  return writeRaw(socket, `${line}\r\n`)
}

function writeRaw(socket: TestSocket, data: Buffer | string): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(data, (error) => {
      if (error) {
        reject(toImapConnectionError(error))
        return
      }

      resolve()
    })
  })
}

function waitForContinuation(socket: TestSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('IMAP 服务器响应超时。'))
    }, CONNECTION_TIMEOUT_MS)

    function cleanup(): void {
      clearTimeout(timeout)
      socket.off('data', handleData)
      socket.off('error', handleError)
      socket.off('close', handleClose)
    }

    function handleData(chunk: Buffer): void {
      buffer += chunk.toString('utf8')
      if (/^\+\s?/m.test(buffer)) {
        cleanup()
        resolve()
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
