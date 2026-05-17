import { CalendarDays, ChevronDown, Mail, Star, X } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@renderer/components/ui/toggle-group'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { MailFilterTag } from './types'

const quickFilters: Array<{
  value: MailFilterTag
  labelKey: TranslationKey
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}> = [
  { value: 'unread', labelKey: 'mail.filter.unread', icon: Mail },
  { value: 'starred', labelKey: 'mail.filter.starred', icon: Star }
]

const dateFilters: Array<{
  value: MailFilterTag
  labelKey: TranslationKey
}> = [
  { value: 'today', labelKey: 'mail.filter.today' },
  { value: 'yesterday', labelKey: 'mail.filter.yesterday' },
  { value: 'last7', labelKey: 'mail.filter.last7' }
]

const dateFilterValues = dateFilters.map((filter) => filter.value)
const filterBadgeClassName =
  'h-6 rounded-full px-2.5 py-0 text-[11px] leading-none font-medium [&_svg:not([class*=size-])]:size-3'

export function MailFilterTags({
  value,
  onValueChange
}: {
  value: MailFilterTag[]
  onValueChange: (value: MailFilterTag[]) => void
}): React.JSX.Element {
  const { t } = useI18n()
  const dateFilter = value.find(isDateFilter)
  const dateLabelKey = dateFilters.find((filter) => filter.value === dateFilter)?.labelKey
  const dateLabel = dateLabelKey ? t(dateLabelKey) : t('mail.filter.time')

  return (
    <div
      className="flex w-full flex-wrap items-center justify-start gap-1.5"
      aria-label={t('mail.filter.region')}
    >
      <ToggleGroup
        type="multiple"
        value={value.filter((filter) => !isDateFilter(filter))}
        onValueChange={(nextValue) =>
          onValueChange([
            ...nextValue.map((filter) => filter as MailFilterTag),
            ...getDateFilters(value)
          ])
        }
        className="flex flex-wrap justify-start gap-1.5"
        aria-label={t('mail.filter.status')}
      >
        {quickFilters.map((filter) => {
          const Icon = filter.icon
          const label = t(filter.labelKey)

          return (
            <ToggleGroupItem
              key={filter.value}
              value={filter.value}
              aria-label={label}
              className={filterBadgeClassName}
            >
              <Icon data-icon="inline-start" />
              <span>{label}</span>
            </ToggleGroupItem>
          )
        })}
      </ToggleGroup>

      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            'inline-flex shrink-0 items-center justify-center gap-1 border border-border bg-background text-foreground whitespace-nowrap outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
            filterBadgeClassName,
            dateFilter && 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90'
          )}
          aria-label={t('mail.filter.date')}
        >
          <CalendarDays data-icon="inline-start" />
          <span>{dateLabel}</span>
          {dateFilter ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={t('mail.filter.clearDate')}
              className="-mr-0.5 inline-flex size-3.5 items-center justify-center rounded-full outline-none hover:bg-primary-foreground/20 focus-visible:ring-2 focus-visible:ring-primary-foreground/70"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onValueChange(value.filter((filter) => filter !== dateFilter))
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                onValueChange(value.filter((filter) => filter !== dateFilter))
              }}
            >
              <X aria-hidden="true" />
            </span>
          ) : (
            <ChevronDown data-icon="inline-end" className="opacity-70" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-28 text-xs" align="start">
          <DropdownMenuRadioGroup
            value={dateFilter ?? ''}
            onValueChange={(nextValue) => {
              const nextDateFilter = nextValue as MailFilterTag
              onValueChange(
                dateFilter === nextDateFilter
                  ? value.filter((filter) => filter !== nextDateFilter)
                  : [...value.filter((filter) => !isDateFilter(filter)), nextDateFilter]
              )
            }}
          >
            {dateFilters.map((filter) => (
              <DropdownMenuRadioItem
                key={filter.value}
                value={filter.value}
                className="py-1 text-xs"
              >
                {t(filter.labelKey)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function getDateFilters(filters: MailFilterTag[]): MailFilterTag[] {
  return filters.filter(isDateFilter)
}

function isDateFilter(filter: MailFilterTag): boolean {
  return dateFilterValues.includes(filter)
}
