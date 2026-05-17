import * as React from 'react'
import { Trash2, X } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { useI18n } from '@renderer/lib/i18n'

type MailListSelectionToolbarProps = {
  selectedCount: number
  allVisibleSelected: boolean
  someVisibleSelected: boolean
  disabled?: boolean
  onSelectAllVisible: () => void
  onClearSelection: () => void
  onDeleteSelected: () => void
}

export function MailListSelectionToolbar({
  selectedCount,
  allVisibleSelected,
  someVisibleSelected,
  disabled = false,
  onSelectAllVisible,
  onClearSelection,
  onDeleteSelected
}: MailListSelectionToolbarProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <div className="app-no-drag flex min-h-10 items-center gap-2 border-t px-4 py-2">
      <Checkbox
        checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
        disabled={disabled}
        aria-label={t('mail.selection.selectVisible')}
        onCheckedChange={onSelectAllVisible}
      />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {t('mail.selection.selectedCount', { count: selectedCount })}
      </span>
      <Button size="sm" variant="outline" disabled={disabled} onClick={onDeleteSelected}>
        <Trash2 data-icon="inline-start" />
        {t('mail.selection.deletePermanently')}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={disabled}
        aria-label={t('mail.selection.clear')}
        onClick={onClearSelection}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  )
}
