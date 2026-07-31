import * as React from 'react'
import { Slot } from 'radix-ui'

import { cn } from '@renderer/lib/utils'

type SweepShineProps = React.ComponentProps<'span'> & {
  active?: boolean
  asChild?: boolean
}

const SWEEP_SHINE_CSS = `
  @keyframes sweep-shine {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .sweep-shine {
    -webkit-text-fill-color: transparent;
    background: linear-gradient(
      90deg,
      currentColor 0%,
      currentColor 40%,
      color-mix(in srgb, currentColor 25%, white) 50%,
      currentColor 60%,
      currentColor 100%
    ) 0 0 / 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    animation: 4s linear infinite sweep-shine;
  }

  @media (prefers-reduced-motion: reduce) {
    .sweep-shine {
      animation: none;
      -webkit-text-fill-color: currentColor;
      background: none;
    }
  }
`

export function SweepShine({
  active = true,
  asChild = false,
  className,
  ...props
}: SweepShineProps): React.JSX.Element {
  const Comp = asChild ? Slot.Root : 'span'

  return (
    <>
      <style>{SWEEP_SHINE_CSS}</style>
      <Comp className={cn(active && 'sweep-shine', className)} {...props} />
    </>
  )
}
