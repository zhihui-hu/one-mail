import * as React from 'react'
import { X } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'

type AddressInputProps = {
  id: string
  value: string[]
  placeholder?: string
  disabled?: boolean
  onChange: (value: string[]) => void
}

export function AddressInput({
  id,
  value,
  placeholder,
  disabled,
  onChange
}: AddressInputProps): React.JSX.Element {
  const [draft, setDraft] = React.useState('')

  function commitDraft(): void {
    const nextItems = splitAddresses(draft)
    if (nextItems.length === 0) return

    const existing = new Set(value.map((item) => item.toLowerCase()))
    const merged = [...value]
    for (const item of nextItems) {
      if (!existing.has(item.toLowerCase())) merged.push(item)
    }
    onChange(merged)
    setDraft('')
  }

  function removeAddress(address: string): void {
    onChange(value.filter((item) => item !== address))
  }

  return (
    <div className="flex min-h-8 w-full min-w-0 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1 focus-within:ring-2 focus-within:ring-ring/50">
      {value.map((address) => (
        <span
          key={address}
          className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
        >
          <span className="max-w-48 truncate">{address}</span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={`移除 ${address}`}
            disabled={disabled}
            onClick={() => removeAddress(address)}
          >
            <X aria-hidden="true" />
          </Button>
        </span>
      ))}
      <Input
        id={id}
        value={draft}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="h-6 min-w-36 flex-1 border-0 bg-transparent px-0 py-0 shadow-none focus-visible:ring-0"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
            event.preventDefault()
            commitDraft()
          }
          if (event.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1))
          }
        }}
      />
    </div>
  )
}

function splitAddresses(value: string): string[] {
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}
