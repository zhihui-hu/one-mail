import * as React from 'react'
import { Slot } from 'radix-ui'

import { cn } from '@renderer/lib/utils'

type UnderlineHoverProps = React.ComponentProps<'span'> & {
  asChild?: boolean
}

const UNDERLINE_HOVER_CSS = `
  .underline-hover {
    position: relative;
  }

  .underline-hover::after {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 2px;
    pointer-events: none;
    content: "";
    background: linear-gradient(to right, var(--muted-foreground), var(--primary)) no-repeat;
    background-position: right bottom;
    background-size: 0 2px;
    transition: background-size 0.5s;
  }

  .underline-hover:hover::after,
  .underline-hover:focus-visible::after {
    background-position: left bottom;
    background-size: 100% 1px;
  }

  @media (prefers-reduced-motion: reduce) {
    .underline-hover::after {
      transition: none;
    }
  }
`

export function UnderlineHover({
  asChild = false,
  className,
  ...props
}: UnderlineHoverProps): React.JSX.Element {
  const Comp = asChild ? Slot.Root : 'span'

  React.useInsertionEffect(() => {
    if (document.getElementById('underline-hover-styles')) return

    const style = document.createElement('style')
    style.id = 'underline-hover-styles'
    style.textContent = UNDERLINE_HOVER_CSS
    document.head.append(style)
  }, [])

  return <Comp className={cn('underline-hover', className)} {...props} />
}
