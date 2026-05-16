import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

class NoopResizeObserver implements ResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

if (!globalThis.ResizeObserver) {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver)
}

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback): number => window.setTimeout(() => callback(Date.now()))
}

if (!window.cancelAnimationFrame) {
  window.cancelAnimationFrame = (handle): void => window.clearTimeout(handle)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
