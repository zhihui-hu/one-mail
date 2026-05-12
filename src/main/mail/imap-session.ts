import { Socket, connect as connectTcp } from 'node:net'
import { TLSSocket, connect as connectTls } from 'node:tls'
import type { getAccount } from '../db/repositories/account.repository'

type TestSocket = Socket | TLSSocket
type ImapAccount = NonNullable<ReturnType<typeof getAccount>>

const CONNECTION_TIMEOUT_MS = 15000

export class SimpleImapSession {
  private tagIndex = 1

  private constructor(
    private socket: TestSocket,
    private readonly tagPrefix: string
  ) {}

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
      session.socket = await upgradeToTls(socket, account.imapHost)
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

  async selectInbox(): Promise<void> {
    await this.command('SELECT "INBOX"')
  }

  async fetchRawMessage(uid: number): Promise<string> {
    const response = await this.command(`UID FETCH ${uid} (BODY.PEEK[])`)
    return extractRawMessageLiteral(response)
  }

  async setSeenFlag(uid: number, isRead: boolean): Promise<void> {
    if (!Number.isInteger(uid) || uid <= 0) {
      throw new Error('邮件 UID 无效，无法同步已读状态。')
    }

    const operation = isRead ? '+FLAGS.SILENT' : '-FLAGS.SILENT'
    await this.command(`UID STORE ${uid} ${operation} (\\Seen)`)
  }

  async logout(): Promise<void> {
    await this.command('LOGOUT')
    this.socket.destroy()
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

  private async command(command: string): Promise<string> {
    const tag = `${this.tagPrefix}${String(this.tagIndex++).padStart(4, '0')}`
    await writeLine(this.socket, `${tag} ${command}`)
    const response = await readUntilTagged(this.socket, tag)
    const lastLine = response
      .trimEnd()
      .split(/\r?\n/)
      .findLast((line) => line.trimStart().startsWith(tag))

    if (!lastLine || !new RegExp(`^${tag}\\s+OK\\b`, 'i').test(lastLine.trimStart())) {
      throw new Error(`IMAP 命令失败：${sanitizeImapResponse(lastLine ?? command)}`)
    }

    return response
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

function sanitizeImapResponse(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function quoteAtom(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
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
      reject(error)
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
      reject(error)
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

function readUntilTagged(socket: TestSocket, tag: string): Promise<string> {
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

      if (new RegExp(`(^|\\r?\\n)${tag}\\s+(OK|NO|BAD)\\b`, 'i').test(buffer)) {
        cleanup()
        resolve(buffer)
      }
    }

    function handleError(error: Error): void {
      cleanup()
      reject(error)
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
  return new Promise((resolve, reject) => {
    socket.write(`${line}\r\n`, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}
