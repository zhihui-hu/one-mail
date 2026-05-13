import * as React from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'

export function EllipsisTooltip({
  children,
  className,
  tooltip
}: {
  children: React.ReactNode
  className?: string
  tooltip: string
}): React.JSX.Element {
  const textRef = React.useRef<HTMLSpanElement>(null)
  const [isTruncated, setIsTruncated] = React.useState(false)

  React.useEffect(() => {
    const element = textRef.current
    if (!element) return

    let animationFrame = 0
    const updateTruncation = (): void => {
      animationFrame = 0
      const availableWidth = element.getBoundingClientRect().width
      const parentWidth = element.parentElement?.getBoundingClientRect().width ?? availableWidth
      const renderedWidth = Math.min(availableWidth, parentWidth)

      setIsTruncated(element.scrollWidth > Math.ceil(renderedWidth))
    }
    const scheduleUpdate = (): void => {
      if (animationFrame) return
      animationFrame = window.requestAnimationFrame(updateTruncation)
    }
    const resizeObserver = new ResizeObserver(scheduleUpdate)

    resizeObserver.observe(element)
    if (element.parentElement) resizeObserver.observe(element.parentElement)
    window.addEventListener('resize', scheduleUpdate)
    scheduleUpdate()

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [tooltip, children])

  const text = (
    <span ref={textRef} className={className} title={isTruncated ? tooltip : undefined}>
      {children}
    </span>
  )

  if (!isTruncated) return text

  return (
    <Tooltip>
      <TooltipTrigger asChild>{text}</TooltipTrigger>
      <TooltipContent className="max-w-80 whitespace-normal break-words">{tooltip}</TooltipContent>
    </Tooltip>
  )
}
