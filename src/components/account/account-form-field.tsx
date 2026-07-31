import * as React from 'react'

import { Field, FieldError, FieldLabel } from '@renderer/components/ui/field'
import { useI18n } from '@renderer/lib/i18n'

type AccountFormFieldProps = {
  id: string
  label: string
  error?: string
  required?: boolean
  children: React.ReactNode
}

export function AccountFormField({
  id,
  label,
  error,
  required = false,
  children
}: AccountFormFieldProps): React.JSX.Element {
  const { t } = useI18n()

  return (
    <Field data-invalid={Boolean(error) || undefined}>
      <FieldLabel htmlFor={id}>
        <span>{label}</span>
        {required ? (
          <>
            <span aria-hidden="true" className="text-destructive">
              *
            </span>
            <span className="sr-only">{t('common.required')}</span>
          </>
        ) : null}
      </FieldLabel>
      {children}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}
