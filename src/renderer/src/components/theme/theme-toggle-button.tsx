import * as React from 'react'
import type { MouseEvent } from 'react'
import { MoonStar, SunMedium } from 'lucide-react'

import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useI18n } from '@renderer/lib/i18n'

type ThemeName = 'light' | 'dark'

type ViewTransition = {
  ready: Promise<void>
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => ViewTransition
}

const THEME_TOGGLE_VIEW_TRANSITION_CSS = `
  @supports (view-transition-name: none) {
    :root {
      view-transition-name: root;
    }

    ::view-transition-old(root),
    ::view-transition-new(root) {
      animation: none;
      mix-blend-mode: normal;
    }

    ::view-transition-old(root) {
      z-index: 1;
    }

    ::view-transition-new(root) {
      z-index: 9999;
    }

    [data-theme-switching='dark']::view-transition-old(root) {
      z-index: 9999;
    }

    [data-theme-switching='dark']::view-transition-new(root) {
      z-index: 1;
    }
  }
`

export function ThemeToggleButton(): React.JSX.Element {
  const { t } = useI18n()
  const [theme, setTheme] = React.useState<ThemeName>(() => getDomTheme())

  function applyTheme(nextTheme: ThemeName): void {
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(nextTheme)
    root.style.colorScheme = nextTheme
    window.localStorage.setItem('theme', nextTheme)
    setTheme(nextTheme)
  }

  function handleToggle(event: MouseEvent<HTMLButtonElement>): void {
    const nextTheme: ThemeName = theme === 'dark' ? 'light' : 'dark'
    const transitionDocument = document as DocumentWithViewTransition
    const supportsTransition =
      typeof transitionDocument.startViewTransition === 'function' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!supportsTransition) {
      applyTheme(nextTheme)
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX || rect.left + rect.width / 2
    const y = event.clientY || rect.top + rect.height / 2
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    )

    if (nextTheme === 'dark') {
      document.documentElement.dataset.themeSwitching = 'dark'
    } else {
      delete document.documentElement.dataset.themeSwitching
    }

    const transition = transitionDocument.startViewTransition(() => applyTheme(nextTheme))

    transition.ready.then(() => {
      const clipPath = [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`]

      document.documentElement.animate(
        {
          clipPath: nextTheme === 'dark' ? [...clipPath].reverse() : clipPath
        },
        {
          duration: 500,
          easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
          fill: 'forwards',
          pseudoElement:
            nextTheme === 'dark' ? '::view-transition-old(root)' : '::view-transition-new(root)'
        }
      )
    })

    Promise.all([transition.ready, new Promise<void>((resolve) => setTimeout(resolve, 550))]).then(
      () => {
        delete document.documentElement.dataset.themeSwitching
      }
    )
  }

  return (
    <>
      <style>{THEME_TOGGLE_VIEW_TRANSITION_CSS}</style>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={t('common.switchTheme')}
            size="icon-sm"
            variant="outline"
            onClick={handleToggle}
          >
            {theme === 'dark' ? <SunMedium aria-hidden="true" /> : <MoonStar aria-hidden="true" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('common.switchTheme')}</TooltipContent>
      </Tooltip>
    </>
  )
}

function getDomTheme(): ThemeName {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark'
}
