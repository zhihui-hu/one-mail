import * as React from 'react'
import { Label as LabelPrimitive } from 'radix-ui'

import { cn } from '@renderer/lib/utils'

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>): React.JSX.Element {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex select-none items-center gap-2 text-sm font-medium leading-none',
        className
      )}
      {...props}
    />
  )
}

export { Label }
