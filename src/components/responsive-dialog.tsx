import * as React from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle
} from '@renderer/components/ui/drawer'
import { cn } from '@renderer/lib/utils'

function useMediaQuery(query: string): boolean {
  return React.useSyncExternalStore(
    (onStoreChange) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', onStoreChange)

      return () => media.removeEventListener('change', onStoreChange)
    },
    () => window.matchMedia(query).matches,
    () => false
  )
}

type ResponsiveDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  contentClassName?: string
  headerClassName?: string
  bodyClassName?: string
  footerClassName?: string
}

function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  contentClassName,
  headerClassName,
  bodyClassName,
  footerClassName
}: ResponsiveDialogProps): React.JSX.Element {
  const isDesktop = useMediaQuery('(min-width: 768px)')

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={contentClassName}>
          <DialogHeader className={headerClassName}>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <div className={bodyClassName}>{children}</div>
          {footer ? <DialogFooter className={footerClassName}>{footer}</DialogFooter> : null}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className={contentClassName}>
        <DrawerHeader className={headerClassName}>
          <DrawerTitle>{title}</DrawerTitle>
          {description ? <DrawerDescription>{description}</DrawerDescription> : null}
        </DrawerHeader>
        <div className={cn('overflow-auto', bodyClassName)}>{children}</div>
        {footer ? <DrawerFooter className={footerClassName}>{footer}</DrawerFooter> : null}
      </DrawerContent>
    </Drawer>
  )
}

export { ResponsiveDialog }
