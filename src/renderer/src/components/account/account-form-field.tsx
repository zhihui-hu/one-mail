import * as React from 'react'

import { Field, FieldError, FieldLabel } from '@renderer/components/ui/field'

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
  return (
    <Field data-invalid={Boolean(error) || undefined}>
      <FieldLabel htmlFor={id}>
        <span>{label}</span>
        {required ? (
          <>
            <span aria-hidden="true" className="text-destructive">
              *
            </span>
            <span className="sr-only">必填</span>
          </>
        ) : null}
      </FieldLabel>
      {children}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  )
}
