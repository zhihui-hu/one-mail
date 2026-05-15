import * as React from 'react'
import { Trash2, X } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'

type MailListSelectionToolbarProps = {
  selectedCount: number
  allVisibleSelected: boolean
  someVisibleSelected: boolean
  permanentDeleteAvailable?: boolean
  disabled?: boolean
  onSelectAllVisible: () => void
  onClearSelection: () => void
  onDeleteSelected: () => void
}

export function MailListSelectionToolbar({
  selectedCount,
  allVisibleSelected,
  someVisibleSelected,
  permanentDeleteAvailable = false,
  disabled = false,
  onSelectAllVisible,
  onClearSelection,
  onDeleteSelected
}: MailListSelectionToolbarProps): React.JSX.Element {
  return (
    <div className="app-no-drag flex min-h-10 items-center gap-2 border-t px-4 py-2">
      <Checkbox
        checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
        disabled={disabled}
        aria-label="选择当前加载的邮件"
        onCheckedChange={onSelectAllVisible}
      />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        已选 {selectedCount} 封
      </span>
      <Button size="sm" variant="outline" disabled={disabled} onClick={onDeleteSelected}>
        <Trash2 data-icon="inline-start" />
        {permanentDeleteAvailable ? '永久删除' : '移到废纸篓'}
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        disabled={disabled}
        aria-label="清空选择"
        onClick={onClearSelection}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  )
}
