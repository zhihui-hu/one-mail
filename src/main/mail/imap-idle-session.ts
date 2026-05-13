import { Socket, connect as connectTcp } from 'node:net'
import { TLSSocket, connect as connectTls } from 'node:tls'
import type { getAccount } from '../db/repositories/account.repository'
import { toImapConnectionError } from './imap-errors'

type TestSocket = Socket | TLSSocket
type ImapAccount = NonNullable<ReturnType<typeof getAccount>>

export type IdleMailboxStatus = {
  path: string
  uidNext?: number
  totalCount?: number
  unreadCount?: number
}

export type IdleWatchMailbox = {
  path: string
  role: 'inbox' | 'junk'
}

type IdleResult = {
  changed: boolean
  reason: 'exists' | 'expunge' | 'fetch' | 'recent' | 'timeout' | 'closed'
}

const CONNECTION_TIMEOUT_MS = 15000

export class ImapIdleSession {
  private tagIndex = 1
  private socketError: Error | undefined
  private readonly socketErrorGuard = (error: Error): void => {
    this.socketError = toImapConnectionError(error)
  }

  private constructor(private socket: TestSocket) {
    this.watchSocketErrors(socket)
  }

  static async connect(account: ImapAccount): Promise<ImapIdleSession> {
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

    const session = new ImapIdleSession(socket)
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

  async capabilities(): Promise<Set<string>> {
    const response = await this.command('CAPABILITY')
    const match = response.match(/^\* CAPABILITY\s+(.+)$/im)
    const values =
      match?.[1]
        ?.trim()
        .split(/\s+/)
        .map((value) => value.toUpperCase()) ?? []

    return new Set(values)
  }

  async selectInbox(): Promise<void> {
    await this.selectMailbox('INBOX')
  }

  async selectMailbox(path: string): Promise<void> {
    await this.command(`SELECT ${quoteAtom(path)}`)
  }

  async statusInbox(): Promise<IdleMailboxStatus> {
    return this.statusMailbox('INBOX')
  }

  async statusMailbox(path: string): Promise<IdleMailboxStatus> {
    const response = await this.command(`STATUS ${quoteAtom(path)} (MESSAGES UNSEEN UIDNEXT)`)
    const values = response.match(/^\* STATUS\s+(?:"[^"]+"|\S+)\s+\(([^)]*)\)/im)?.[1] ?? ''

    return {
      path,
      totalCount: readStatusNumber(values, 'MESSAGES'),
      unreadCount: readStatusNumber(values, 'UNSEEN'),
      uidNext: readStatusNumber(values, 'UIDNEXT')
    }
  }

  async listWatchMailboxes(): Promise<IdleWatchMailbox[]> {
    const response = await this.command('LIST "" "*"')
    return parseWatchMailboxes(response)
  }

  async noop(): Promise<void> {
    await this.command('NOOP')
  }

  async idle(timeoutMs: number): Promise<IdleResult> {
    this.assertSocketHealthy()
    const tag = this.nextTag()
    await writeLine(this.socket, `${tag} IDLE`)
    await this.waitForIdleContinuation()

    return waitForIdleChange(this.socket, tag, timeoutMs)
  }

  async logout(): Promise<void> {
    try {
      await this.command('LOGOUT')
    } finally {
      this.socket.off('error', this.socketErrorGuard)
      this.socket.destroy()
    }
  }

  private nextTag(): string {
    return `I${String(this.tagIndex++).padStart(4, '0')}`
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

  private async waitForIdleContinuation(): Promise<void> {
    await waitForLine(this.socket, (line) => {
      if (/^\+\s/.test(line)) return true
      if (/^\*\s+BYE\b/i.test(line)) {
        throw new Error(`IMAP 连接已断开：${line}`)
      }
      return false
    })
  }

  private async command(command: string): Promise<string> {
    this.assertSocketHealthy()
    const tag = this.nextTag()
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

function waitForIdleChange(
  socket: TestSocket,
  tag: string,
  timeoutMs: number
): Promise<IdleResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let doneSent = false
    let pendingReason: IdleResult['reason'] | undefined
    let buffer = ''
    let doneTimeout: NodeJS.Timeout | undefined
    const timeout = setTimeout(() => {
      sendDone('timeout')
    }, timeoutMs)

    function cleanup(): void {
      clearTimeout(timeout)
      if (doneTimeout) clearTimeout(doneTimeout)
      socket.off('data', handleData)
      socket.off('error', handleError)
      socket.off('close', handleClose)
    }

    function finish(result: IdleResult): void {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    function fail(error: Error): void {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    function sendDone(reason: IdleResult['reason']): void {
      if (doneSent || settled) return
      doneSent = true
      pendingReason = reason
      socket.write('DONE\r\n', (error) => {
        if (error) {
          fail(toImapConnectionError(error))
          return
        }

        if (reason === 'timeout') {
          doneTimeout = setTimeout(() => {
            finish({ changed: false, reason })
          }, CONNECTION_TIMEOUT_MS)
        }
      })
    }

    function handleData(chunk: Buffer): void {
      buffer += chunk.toString('utf8')
      const changeReason = getIdleChangeReason(buffer)

      if (changeReason && !doneSent) {
        sendDone(changeReason)
      }

      if (new RegExp(`(^|\\r?\\n)${tag}\\s+OK\\b`, 'i').test(buffer)) {
        finish({
          changed: Boolean(pendingReason && pendingReason !== 'timeout'),
          reason: pendingReason ?? 'closed'
        })
      }
    }

    function handleError(error: Error): void {
      fail(toImapConnectionError(error))
    }

    function handleClose(): void {
      finish({ changed: false, reason: 'closed' })
    }

    socket.on('data', handleData)
    socket.once('error', handleError)
    socket.once('close', handleClose)
  })
}

function getIdleChangeReason(value: string): IdleResult['reason'] | undefined {
  if (/^\*\s+\d+\s+EXISTS\b/im.test(value)) return 'exists'
  if (/^\*\s+\d+\s+EXPUNGE\b/im.test(value)) return 'expunge'
  if (/^\*\s+\d+\s+RECENT\b/im.test(value)) return 'recent'
  if (/^\*\s+\d+\s+FETCH\b/im.test(value)) return 'fetch'
  return undefined
}

function readStatusNumber(values: string, key: string): number | undefined {
  const match = new RegExp(`\\b${key}\\s+(\\d+)`, 'i').exec(values)
  const value = Number(match?.[1])
  return Number.isInteger(value) && value >= 0 ? value : undefined
}

function parseWatchMailboxes(response: string): IdleWatchMailbox[] {
  const mailboxes: IdleWatchMailbox[] = []

  for (const line of response.split(/\r?\n/)) {
    const mailbox = parseWatchMailboxLine(line.trim())
    if (mailbox) mailboxes.push(mailbox)
  }

  return uniqueWatchMailboxes(mailboxes)
}

function parseWatchMailboxLine(line: string): IdleWatchMailbox | null {
  const match = /^\* LIST \(([^)]*)\) (?:(NIL)|"([^"]*)") (.+)$/i.exec(line)
  if (!match) return null

  const path = parseImapString(match[4])
  if (!path) return null

  const attributes = match[1]
    .split(/\s+/)
    .map((value) => value.replace(/^\\/, ''))
    .filter(Boolean)
  if (hasAttribute(attributes, 'Noselect')) return null

  const displayPath = decodeModifiedUtf7(path)
  const role = detectWatchMailboxRole(displayPath, attributes)
  return role ? { path, role } : null
}

function parseImapString(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed || /^NIL$/i.test(trimmed)) return undefined

  if (!trimmed.startsWith('"')) return trimmed

  let result = ''
  for (let index = 1; index < trimmed.length; index += 1) {
    const char = trimmed[index]
    if (char === '"') return result
    if (char === '\\' && index + 1 < trimmed.length) {
      index += 1
      result += trimmed[index]
      continue
    }
    result += char
  }

  return result
}

function detectWatchMailboxRole(
  path: string,
  attributes: string[]
): IdleWatchMailbox['role'] | undefined {
  if (hasAttribute(attributes, 'Inbox') || path.toUpperCase() === 'INBOX') return 'inbox'
  if (hasAttribute(attributes, 'Junk')) return 'junk'

  const normalizedPath = normalizeMailboxPath(path)
  if (
    [
      'junk',
      'spam',
      'bulk mail',
      'bulk',
      'junk email',
      'junk e-mail',
      '垃圾邮件',
      '垃圾邮件箱',
      '垃圾邮箱'
    ].includes(normalizedPath) ||
    normalizedPath.endsWith('/junk') ||
    normalizedPath.endsWith('/spam') ||
    normalizedPath.endsWith('/junk email') ||
    normalizedPath.endsWith('/junk e-mail') ||
    normalizedPath.endsWith('/垃圾邮件') ||
    normalizedPath.endsWith('/垃圾邮件箱') ||
    normalizedPath.endsWith('/垃圾邮箱')
  ) {
    return 'junk'
  }

  return undefined
}

function uniqueWatchMailboxes(mailboxes: IdleWatchMailbox[]): IdleWatchMailbox[] {
  const seen = new Set<string>()

  return mailboxes.filter((mailbox) => {
    const key = mailbox.path.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function hasAttribute(attributes: string[], attributeName: string): boolean {
  return attributes.some((attribute) => attribute.toLowerCase() === attributeName.toLowerCase())
}

function normalizeMailboxPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
    .toLowerCase()
}

function decodeModifiedUtf7(value: string): string {
  return value.replace(/&([^-]*)-/g, (match, encoded: string) => {
    if (encoded === '') return '&'

    try {
      return decodeUtf16BigEndian(Buffer.from(encoded.replace(/,/g, '/'), 'base64'))
    } catch {
      return match
    }
  })
}

function decodeUtf16BigEndian(buffer: Buffer): string {
  if (buffer.length % 2 !== 0) return ''

  let result = ''
  for (let index = 0; index < buffer.length; index += 2) {
    result += String.fromCharCode(buffer.readUInt16BE(index))
  }

  return result
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
