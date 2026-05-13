const BORINGSSL_BAD_DECRYPT_PATTERN =
  /Cipher functions:OPENSSL_internal:BAD_DECRYPT|OPENSSL_internal:BAD_DECRYPT|e_aes\.cc\.inc/i

let installed = false

export function installRuntimeErrorGuards(): void {
  if (installed) return
  installed = true

  process.on('uncaughtException', handleUncaughtException)
  process.on('unhandledRejection', handleUnhandledRejection)
}

export function isBoringSslBadDecryptError(error: unknown): boolean {
  return BORINGSSL_BAD_DECRYPT_PATTERN.test(getErrorMessage(error))
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack || error.message
  if (typeof error === 'string') return error

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function handleUncaughtException(error: Error): void {
  if (isBoringSslBadDecryptError(error)) {
    console.warn('Ignored BoringSSL BAD_DECRYPT runtime error.')
    return
  }

  process.off('uncaughtException', handleUncaughtException)
  throw error
}

function handleUnhandledRejection(reason: unknown): void {
  if (isBoringSslBadDecryptError(reason)) {
    console.warn('Ignored BoringSSL BAD_DECRYPT unhandled rejection.')
    return
  }

  throw reason instanceof Error ? reason : new Error(getErrorMessage(reason))
}
