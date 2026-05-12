import { BrowserWindow, clipboard } from 'electron'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { join } from 'node:path'
import { URLSearchParams } from 'node:url'
import type { OAuthAuthorizationMode } from '../../shared/types'
import { saveOAuthToken, readOAuthToken, type OAuthTokenPayload } from './oauth-token-store'

type MicrosoftTokenResponse = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

type AuthorizationResult = {
  code: string
  redirectUri: string
}

type MicrosoftAuthorizationSession = {
  email: string
  token: OAuthTokenPayload
}

const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const MICROSOFT_SCOPES = ['offline_access', 'https://outlook.office.com/IMAP.AccessAsUser.All']
const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000

export async function authorizeMicrosoftAccount(
  mode: OAuthAuthorizationMode = 'internal_browser'
): Promise<MicrosoftAuthorizationSession> {
  const clientId = getMicrosoftClientId()
  const verifier = base64Url(randomBytes(48))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  const state = base64Url(randomBytes(24))
  const authorization = await waitForMicrosoftAuthorization(clientId, challenge, state, mode)
  const token = await requestMicrosoftToken({
    clientId,
    code: authorization.code,
    codeVerifier: verifier,
    redirectUri: authorization.redirectUri
  })

  return {
    email: getEmailFromAccessToken(token.accessToken),
    token
  }
}

export function saveMicrosoftAuthorization(accountId: number, token: OAuthTokenPayload): void {
  saveOAuthToken(accountId, 'outlook', token, MICROSOFT_SCOPES)
}

export async function getMicrosoftAccessToken(accountId: number): Promise<string> {
  const token = readOAuthToken(accountId)
  if (!shouldRefreshToken(token)) return token.accessToken

  if (!token.refreshToken) {
    throw new Error('Microsoft OAuth refresh token 不存在，请重新登录 Outlook。')
  }

  const refreshed = await refreshMicrosoftToken(getMicrosoftClientId(), token.refreshToken)
  saveOAuthToken(accountId, 'outlook', refreshed, MICROSOFT_SCOPES)
  return refreshed.accessToken
}

function getMicrosoftClientId(): string {
  const clientId = process.env.ONEMAIL_MICROSOFT_CLIENT_ID?.trim() ?? readLocalEnvClientId()
  if (clientId) return clientId

  throw new Error(
    '缺少 ONEMAIL_MICROSOFT_CLIENT_ID。请先在 Microsoft Entra 注册桌面应用，并配置 http://localhost 回调 URI。'
  )
}

function readLocalEnvClientId(): string | undefined {
  const envPath = join(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return undefined

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const match = /^\s*ONEMAIL_MICROSOFT_CLIENT_ID\s*=\s*(.+?)\s*$/.exec(line)
    if (match) return match[1].replace(/^"|"$/g, '').trim()
  }

  return undefined
}

function waitForMicrosoftAuthorization(
  clientId: string,
  codeChallenge: string,
  state: string,
  mode: OAuthAuthorizationMode
): Promise<AuthorizationResult> {
  return new Promise((resolve, reject) => {
    let redirectUri = ''
    let authWindow: BrowserWindow | undefined
    let settled = false

    function settleReject(error: Error): void {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    function settleResolve(result: AuthorizationResult): void {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const server = http.createServer((request, response) => {
      const host = request.headers.host
      const url = new URL(request.url ?? '/', `http://${host}`)

      if (url.pathname !== '/oauth/microsoft/callback') {
        response.writeHead(404)
        response.end('Not found')
        return
      }

      const error = url.searchParams.get('error')
      if (error) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end('<h1>OneMail Microsoft 登录失败</h1><p>可以关闭此窗口。</p>')
        settleReject(new Error(url.searchParams.get('error_description') ?? error))
        return
      }

      if (url.searchParams.get('state') !== state) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end('<h1>OneMail Microsoft 登录失败</h1><p>state 校验失败。</p>')
        settleReject(new Error('Microsoft OAuth state 校验失败。'))
        return
      }

      const code = url.searchParams.get('code')
      if (!code) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        response.end('<h1>OneMail Microsoft 登录失败</h1><p>没有收到授权码。</p>')
        settleReject(new Error('Microsoft OAuth 未返回授权码。'))
        return
      }

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end('<h1>OneMail Microsoft 登录成功</h1><p>可以关闭此窗口并返回 OneMail。</p>')
      settleResolve({ code, redirectUri })
    })

    const timeout = setTimeout(
      () => {
        settleReject(new Error('Microsoft 登录超时，请重试。'))
      },
      5 * 60 * 1000
    )

    function cleanup(): void {
      clearTimeout(timeout)
      server.close()
      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.close()
      }
      authWindow = undefined
    }

    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://localhost:${addressPort(server)}/oauth/microsoft/callback`
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        response_mode: 'query',
        scope: MICROSOFT_SCOPES.join(' '),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      })
      const authorizationUrl = `${MICROSOFT_AUTHORITY}/authorize?${params.toString()}`

      if (mode === 'copy_link') {
        clipboard.writeText(authorizationUrl)
        return
      }

      authWindow = createMicrosoftAuthorizationWindow()
      authWindow.on('closed', () => {
        authWindow = undefined
        settleReject(new Error('Microsoft 授权窗口已关闭。'))
      })
      void authWindow.loadURL(authorizationUrl)
    })

    server.on('error', (error) => {
      settleReject(error)
    })
  })
}

function createMicrosoftAuthorizationWindow(): BrowserWindow {
  const authWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    show: true,
    autoHideMenuBar: true,
    title: 'Microsoft 授权 - OneMail',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  authWindow.webContents.setWindowOpenHandler(({ url }) => {
    void authWindow.loadURL(url)
    return { action: 'deny' }
  })

  return authWindow
}

async function requestMicrosoftToken({
  clientId,
  code,
  codeVerifier,
  redirectUri
}: {
  clientId: string
  code: string
  codeVerifier: string
  redirectUri: string
}): Promise<OAuthTokenPayload> {
  const params = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    scope: MICROSOFT_SCOPES.join(' ')
  })

  return mapTokenResponse(await postMicrosoftToken(params))
}

async function refreshMicrosoftToken(
  clientId: string,
  refreshToken: string
): Promise<OAuthTokenPayload> {
  const params = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: MICROSOFT_SCOPES.join(' ')
  })

  return mapTokenResponse(await postMicrosoftToken(params))
}

async function postMicrosoftToken(params: URLSearchParams): Promise<MicrosoftTokenResponse> {
  const response = await fetch(`${MICROSOFT_AUTHORITY}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  })
  const body = (await response.json()) as MicrosoftTokenResponse

  if (!response.ok || body.error) {
    throw new Error(body.error_description ?? body.error ?? 'Microsoft OAuth token 请求失败。')
  }

  return body
}

function mapTokenResponse(body: MicrosoftTokenResponse): OAuthTokenPayload {
  if (!body.access_token) {
    throw new Error('Microsoft OAuth 未返回 access token。')
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    tokenType: body.token_type ?? 'Bearer',
    expiresAt:
      body.expires_in === undefined
        ? undefined
        : new Date(Date.now() + body.expires_in * 1000).toISOString()
  }
}

function getEmailFromAccessToken(accessToken: string): string {
  const payload = decodeJwtPayload(accessToken)
  const email =
    readStringClaim(payload, 'preferred_username') ??
    readStringClaim(payload, 'email') ??
    readStringClaim(payload, 'upn')

  if (!email) {
    throw new Error('Microsoft OAuth 未返回邮箱地址，请确认授权账号有效。')
  }

  return email
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  if (!payload) throw new Error('Microsoft OAuth access token 格式无效。')

  try {
    return JSON.parse(Buffer.from(fromBase64Url(payload), 'base64').toString('utf8')) as Record<
      string,
      unknown
    >
  } catch {
    throw new Error('Microsoft OAuth access token 解析失败。')
  }
}

function readStringClaim(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function shouldRefreshToken(token: OAuthTokenPayload): boolean {
  if (!token.expiresAt) return false
  const expiresAt = new Date(token.expiresAt).getTime()
  return Number.isNaN(expiresAt) || expiresAt - Date.now() <= TOKEN_REFRESH_SKEW_MS
}

function base64Url(value: Buffer): string {
  return value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
}

function addressPort(server: http.Server): number {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Microsoft OAuth 本地回调服务启动失败。')
  }

  return address.port
}
