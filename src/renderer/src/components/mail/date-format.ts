import { format, formatDistanceToNow } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import type { AppLocale } from '@renderer/lib/i18n'

export function formatRelativeTime(value?: string, locale: AppLocale = 'zh-CN'): string {
  const date = parseDate(value)
  if (!date) return locale === 'en-US' ? 'Unknown time' : ''

  const dateLocale = locale === 'en-US' ? enUS : zhCN
  return normalizeRelativeTime(formatDistanceToNow(date, { addSuffix: true, locale: dateLocale }))
}

export function formatAbsoluteTime(value?: string): string | undefined {
  const date = parseDate(value)
  if (!date) return undefined

  return format(date, 'yyyy-MM-dd HH:mm:ss')
}

function parseDate(value?: string): Date | null {
  if (!value) return null

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeRelativeTime(value: string): string {
  return value.replace(/^(大约|大概|约)\s*/, '')
}
