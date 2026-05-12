import { format, formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

export function formatRelativeTime(value?: string): string {
  const date = parseDate(value)
  if (!date) return '未知时间'

  return formatDistanceToNow(date, { addSuffix: true, locale: zhCN })
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
