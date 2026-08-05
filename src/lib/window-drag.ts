import { getCurrentWindow } from '@tauri-apps/api/window'
import type { MouseEvent } from 'react'

const NON_DRAG_SELECTOR = '.app-no-drag, button, a, input, textarea, select, [data-no-drag]'

export function startWindowDrag(event: MouseEvent<HTMLElement>): void {
  if (event.button !== 0) return
  if (!('__TAURI_INTERNALS__' in window)) return

  const target = event.target
  if (target instanceof Element && target.closest(NON_DRAG_SELECTOR)) return

  void getCurrentWindow().startDragging().catch((error) => {
    console.warn('Failed to drag the current window.', error)
  })
}
