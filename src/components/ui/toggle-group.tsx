import * as React from 'react'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import { type VariantProps } from 'class-variance-authority'

import { buttonVariants } from '@renderer/components/ui/button-variants'
import { cn } from '@renderer/lib/utils'

function ToggleGroup({
  className,
  variant,
  size,
  children,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  VariantProps<typeof buttonVariants>): React.JSX.Element {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      className={cn('group/toggle-group flex w-fit items-center gap-1', className)}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Root>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = 'outline',
  size = 'sm',
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> &
  VariantProps<typeof buttonVariants>): React.JSX.Element {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        buttonVariants({ variant, size }),
        'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground',
        className
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}

export { ToggleGroup, ToggleGroupItem }
