import { Mail, Paperclip, Star } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import type { MailFilterTag } from './types'

const filters: Array<{
  value: MailFilterTag
  label: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}> = [
  { value: 'unread', label: '未读', icon: Mail },
  { value: 'attachments', label: '附件', icon: Paperclip },
  { value: 'starred', label: '星标', icon: Star }
]

export function MailFilterTags({
  value,
  onValueChange
}: {
  value: MailFilterTag[]
  onValueChange: (value: MailFilterTag[]) => void
}): React.JSX.Element {
  return (
    <ToggleGroup
      type="multiple"
      value={value}
      onValueChange={(nextValue) => onValueChange(nextValue as MailFilterTag[])}
      className="flex w-full flex-wrap justify-start gap-1"
      aria-label="邮件筛选"
    >
      {filters.map((filter) => {
        const Icon = filter.icon

        return (
          <ToggleGroupItem
            key={filter.value}
            value={filter.value}
            aria-label={filter.label}
            className="h-7 rounded-md px-2.5 text-xs font-medium"
          >
            <Icon data-icon="inline-start" />
            <span>{filter.label}</span>
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}
