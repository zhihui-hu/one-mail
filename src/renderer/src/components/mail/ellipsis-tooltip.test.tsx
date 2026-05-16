import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@renderer/components/ui/tooltip'
import { EllipsisTooltip } from './ellipsis-tooltip'

function rect(width: number): DOMRect {
  return {
    bottom: 20,
    height: 20,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
    toJSON: () => ({})
  } as DOMRect
}

function mockMeasuredText({ renderedWidth, scrollWidth }: { renderedWidth: number; scrollWidth: number }): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.textContent?.includes('很长的邮箱地址') ? rect(renderedWidth) : rect(320)
  })
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.textContent?.includes('很长的邮箱地址') ? scrollWidth : 320
  })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0)
    return 1
  })
}

describe('EllipsisTooltip', () => {
  it('shows a tooltip when the text is measured as truncated', async () => {
    const tooltip = '很长的邮箱地址 <long-address@example.com>'
    mockMeasuredText({ renderedWidth: 120, scrollWidth: 260 })

    render(
      <TooltipProvider>
        <EllipsisTooltip className="truncate" tooltip={tooltip}>
          {tooltip}
        </EllipsisTooltip>
      </TooltipProvider>
    )

    await userEvent.hover(screen.getByTitle(tooltip))

    expect(await screen.findByRole('tooltip')).toHaveTextContent(tooltip)
  })

  it('can force the tooltip for important metadata without relying on measurement', async () => {
    const tooltip = '很长的邮箱地址 <important@example.com>'
    mockMeasuredText({ renderedWidth: 260, scrollWidth: 120 })

    render(
      <TooltipProvider>
        <EllipsisTooltip alwaysShow className="truncate" tooltip={tooltip}>
          {tooltip}
        </EllipsisTooltip>
      </TooltipProvider>
    )

    await userEvent.hover(screen.getByTitle(tooltip))

    expect(await screen.findByRole('tooltip')).toHaveTextContent(tooltip)
  })
})
