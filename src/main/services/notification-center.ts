import { BrowserWindow, Notification, shell } from 'electron'
import { getAccount } from '../db/repositories/account.repository'
import { listRecentNotificationMessages } from '../db/repositories/message.repository'
import type { MailboxChangedEvent, NewMailNotification, NotificationStatus } from '../ipc/types'

const MAX_NOTIFICATION_MESSAGES = 5

export function getNotificationStatus(): NotificationStatus {
  return {
    desktopSupported: Notification.isSupported()
  }
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
  const messages = listRecentNotificationMessages(
    accountId,
    Math.min(messageCount, MAX_NOTIFICATION_MESSAGES)
  )
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
  showDesktopNotification(notification)
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

function showDesktopNotification(notification: NewMailNotification): void {
  if (!Notification.isSupported()) return

  const firstMessage = notification.messages[0]
  const sender = firstMessage?.fromName ?? firstMessage?.fromEmail ?? notification.accountLabel
  const title =
    notification.messageCount === 1
      ? firstMessage?.subject || '收到新邮件'
      : `收到 ${notification.messageCount} 封新邮件`
  const body =
    notification.messageCount === 1
      ? [sender, firstMessage?.snippet].filter(Boolean).join(' - ')
      : notification.accountLabel || notification.accountEmail || 'OneMail'

  new Notification({
    title,
    body
  }).show()
}
