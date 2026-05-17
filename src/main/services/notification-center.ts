import { BrowserWindow, Notification, nativeImage, shell, type NativeImage } from 'electron'
import appIcon from '../../../resources/icon.png?asset'
import { getAccount } from '../db/repositories/account.repository'
import { listRecentNotificationMessages } from '../db/repositories/message.repository'
import { getLogoDataUrl } from '../ipc/logos'
import type {
  MailAccount,
  MailboxChangedEvent,
  NewMailNotification,
  NewMailNotificationMessage,
  NotificationStatus
} from '../ipc/types'

let openWindowHandler: ((route: string) => BrowserWindow | null) | null = null

export function getNotificationStatus(): NotificationStatus {
  return {
    desktopSupported: Notification.isSupported()
  }
}

export function setNotificationOpenWindowHandler(
  handler: (route: string) => BrowserWindow | null
): void {
  openWindowHandler = handler
}

export function notifyNewMail({
  accountId,
  messageCount,
  reason
}: {
  accountId: number
  messageCount: number
  reason: MailboxChangedEvent['reason']
}): void {
  if (messageCount <= 0) return

  const account = getAccount(accountId)
  const messages = listRecentNotificationMessages(accountId, messageCount)
  const notification: NewMailNotification = {
    notificationId: `${accountId}-${Date.now()}`,
    accountId,
    accountEmail: account?.email,
    accountLabel: account?.accountLabel,
    reason,
    messageCount,
    messages,
    notifiedAt: new Date().toISOString()
  }

  playNotificationSound()
  broadcastNewMail(notification)
  void showDesktopNotifications(notification, account)
}

function playNotificationSound(): void {
  shell.beep()
}

function broadcastNewMail(notification: NewMailNotification): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('notifications/newMail', notification)
    }
  }
}

async function showDesktopNotifications(
  notification: NewMailNotification,
  account: MailAccount | null
): Promise<void> {
  if (!Notification.isSupported()) return

  const icon = await getNotificationIcon(account, notification)
  const messages = notification.messages.length > 0 ? notification.messages : [undefined]

  for (const message of messages) {
    showDesktopNotification(notification, message, icon)
  }
}

function showDesktopNotification(
  notification: NewMailNotification,
  message: NewMailNotificationMessage | undefined,
  icon: string | NativeImage
): void {
  const sender = message?.fromName ?? message?.fromEmail ?? notification.accountLabel
  const verificationCode = message?.verificationCode
  const title = message?.subject || '收到新邮件'
  const body = verificationCode
    ? [sender, `验证码 ${verificationCode}`].filter(Boolean).join(' - ')
    : [sender, message?.snippet].filter(Boolean).join(' - ') ||
      notification.accountLabel ||
      notification.accountEmail ||
      'OneMail'

  const desktopNotification = new Notification({
    title,
    body,
    icon
  })

  desktopNotification.on('click', () => {
    openNotificationTarget(notification, message)
  })
  desktopNotification.show()
}

function openNotificationTarget(
  notification: NewMailNotification,
  message?: NewMailNotificationMessage
): void {
  const route = toNotificationRoute(notification, message)

  const window = getOpenTargetWindow(route)
  if (!window) return

  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
  navigateWindowToRoute(window, route)
}

function getOpenTargetWindow(route: string): BrowserWindow | null {
  const handledWindow = openWindowHandler?.(route)
  if (handledWindow && !handledWindow.isDestroyed()) return handledWindow

  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null
}

function toNotificationRoute(
  notification: NewMailNotification,
  message?: NewMailNotificationMessage
): string {
  const messageId = message?.messageId ?? getNotificationDisplayMessage(notification)?.messageId
  return messageId ? `/${notification.accountId}/${messageId}` : '/'
}

function navigateWindowToRoute(window: BrowserWindow, route: string): void {
  if (window.isDestroyed()) return

  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', () => navigateWindowToRoute(window, route))
    return
  }

  void window.webContents
    .executeJavaScript(`window.location.hash = ${JSON.stringify(route)}`)
    .catch(() => undefined)
}

function getNotificationDisplayMessage(
  notification: NewMailNotification
): NewMailNotificationMessage | undefined {
  return (
    notification.messages.find((message) => message.verificationCode) ?? notification.messages[0]
  )
}

async function getNotificationIcon(
  account: MailAccount | null,
  notification: NewMailNotification
): Promise<string | NativeImage> {
  const domain = getProviderLogoDomain(account, notification)
  const logo = domain ? await getLogoDataUrl(domain) : null
  if (!logo) return appIcon

  const image = nativeImage.createFromDataURL(logo)
  return image.isEmpty() ? appIcon : image
}

function getProviderLogoDomain(
  account: MailAccount | null,
  notification: NewMailNotification
): string {
  const providerKey = normalizeProviderKey(account?.providerKey)
  const address = account?.email ?? notification.accountEmail ?? ''
  const domains: Record<string, string> = {
    gmail: 'gmail.com',
    outlook: 'outlook.com',
    '163': '163.com',
    qq: 'qq.com',
    custom: getEmailDomain(address),
    manual: getEmailDomain(address)
  }

  return domains[providerKey] ?? getEmailDomain(address)
}

function normalizeProviderKey(providerKey?: string): string {
  if (!providerKey) return 'custom'
  const normalized = providerKey.toLowerCase()
  if (normalized.includes('gmail')) return 'gmail'
  if (normalized.includes('outlook') || normalized.includes('microsoft')) return 'outlook'
  if (normalized.includes('163')) return '163'
  if (normalized.includes('qq') || normalized.includes('foxmail')) return 'qq'
  if (normalized.includes('custom')) return 'custom'
  return normalized
}

function getEmailDomain(address: string): string {
  return address.split('@')[1]?.trim().toLowerCase() ?? ''
}
