import * as React from 'react'
import { CheckCheck, Trash2, X } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { useI18n } from '@renderer/lib/i18n'

type MailListSelectionToolbarProps = {
  selectedCount: number
  unreadSelectedCount: number
  allVisibleSelected: boolean
  someVisibleSelected: boolean
  disabled?: boolean
  onSelectAllVisible: () => void
  onClearSelection: () => void
  onMarkSelectedRead: () => void
  onDeleteSelected: () => void
}

export function MailListSelectionToolbar({
  selectedCount,
  unreadSelectedCount,
  allVisibleSelected,
  someVisibleSelected,
  disabled = false,
  onSelectAllVisible,
  onClearSelection,
  onMarkSelectedRead,
  onDeleteSelected
}: MailListSelectionToolbarProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div className="app-no-drag absolute bottom-4 left-1/2 z-30 flex h-14 max-w-[calc(100%_-_24px)] -translate-x-1/2 items-center gap-1.5 rounded-2xl border border-black/10 bg-background/95 px-2.5 shadow-[0_16px_36px_rgb(0_0_0/0.18),0_2px_8px_rgb(0_0_0/0.08)] backdrop-blur-xl dark:border-white/12">
      <label className="flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-xl border bg-muted/35 px-3 text-sm font-semibold shadow-xs">
        <Checkbox
          checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
          disabled={disabled}
          aria-label={t('mail.selection.selectVisible')}
          onCheckedChange={onSelectAllVisible}
        />
        <span className="whitespace-nowrap">
          {t('mail.selection.selectedCount', { count: selectedCount })}
        </span>
      </label>
      <Button
        size="icon-sm"
        variant="ghost"
        className="rounded-xl"
        disabled={disabled}
        aria-label={t('mail.selection.clear')}
        onClick={onClearSelection}
      >
        <X aria-hidden="true" />
      </Button>
      <span className="mx-1 h-7 w-px shrink-0 bg-border" aria-hidden="true" />
      <Button
        size="sm"
        variant="outline"
        className="h-9 shrink-0 rounded-xl px-3 shadow-xs"
        disabled={disabled || unreadSelectedCount === 0}
        onClick={onMarkSelectedRead}
      >
        <CheckCheck data-icon="inline-start" />
        {t('mail.selection.markRead')}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        className="rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
        disabled={disabled}
        aria-label={t('mail.selection.deletePermanently')}
        title={t('mail.selection.deletePermanently')}
        onClick={onDeleteSelected}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </div>
  )
}
