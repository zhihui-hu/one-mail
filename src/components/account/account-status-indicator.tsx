import * as React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

import { SweepShine } from '@renderer/components/sweep-shine'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { useI18n, type TranslationKey } from '@renderer/lib/i18n'
import { cn } from '@renderer/lib/utils'
import type { AccountConnectionStatus } from '@renderer/shared/types'

type AccountStatusIndicatorProps = {
  status?: AccountConnectionStatus
  warning?: boolean
  warningTooltip?: string
}

export function AccountStatusIndicator({
  status,
  warning = false,
  warningTooltip
}: AccountStatusIndicatorProps): React.JSX.Element | null {
  const { t } = useI18n()

  if (!warning && (!status || status === 'connected')) return null

  const label = warningTooltip ?? getConnectionStatusLabel(status, t)
  const isRenewing = status === 'renewing' && !warning
  const Icon = isRenewing ? RefreshCw : AlertTriangle

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex size-5 shrink-0 items-center justify-center [&_svg]:size-3.5',
            isRenewing
              ? 'rounded-full border border-primary/25 bg-primary/12 text-primary shadow-sm'
              : 'text-warning [&_svg]:size-4'
          )}
          aria-label={label}
          role="img"
        >
          <Icon aria-hidden="true" strokeWidth={2.2} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-72 whitespace-normal leading-5">
        {isRenewing ? <SweepShine>{label}</SweepShine> : label}
      </TooltipContent>
    </Tooltip>
  )
}

function getConnectionStatusLabel(
  status: AccountConnectionStatus | undefined,
  t: (key: TranslationKey) => string
): string {
  if (status === 'renewing') return t('account.status.renewing')
  return t('account.status.reauthorize')
}
