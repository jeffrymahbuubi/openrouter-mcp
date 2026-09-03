/**
 * Shared error classification helpers for API client implementations.
 * Used to identify network failures.
 */

interface ErrorWithCode extends Error {
  code?: string
}

const NETWORK_ERROR_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'] as const

export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return NETWORK_ERROR_CODES.some(
    (code) => error.message.includes(code) || (error as ErrorWithCode).code === code
  )
}
