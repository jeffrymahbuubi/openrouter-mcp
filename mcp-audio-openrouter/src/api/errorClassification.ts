/**
 * Shared error classification helpers for API client implementations.
 * Used by the chat-completions client, the speech endpoint, and the model
 * catalog so every OpenRouter call maps failures the same way.
 */

import { AudioAPIError, NetworkError } from '../utils/errors.js'

interface ErrorWithCode extends Error {
  code?: string
}

const NETWORK_ERROR_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'] as const

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return NETWORK_ERROR_CODES.some(
    (code) => error.message.includes(code) || (error as ErrorWithCode).code === code
  )
}

/**
 * Classifies an error thrown by `fetch` or a body read. `fetch` throws
 * TypeError on transport failure and TimeoutError/AbortError on an aborted
 * request: all network-class failures.
 */
export function classifyThrownError(error: unknown): AudioAPIError | NetworkError {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error'
  const name = error instanceof Error ? error.name : ''

  if (
    isNetworkError(error) ||
    error instanceof TypeError ||
    name === 'TimeoutError' ||
    name === 'AbortError'
  ) {
    return new NetworkError(
      'Network error during OpenRouter audio generation',
      'Check your internet connection and try again',
      error instanceof Error ? error : undefined
    )
  }

  return new AudioAPIError('Failed to generate audio with OpenRouter', {
    provider: 'openrouter',
    upstreamMessage: errorMessage,
    suggestion: 'Check OpenRouter API configuration and try again',
  })
}

/**
 * Picks a user-facing suggestion from the HTTP status first, then from the
 * upstream message text.
 */
export function getAPIErrorSuggestion(
  status: number,
  upstreamMessage: string,
  model: string
): string {
  const lowerMessage = upstreamMessage.toLowerCase()

  if (status === 402) {
    return 'Your OpenRouter account has insufficient credits. Add credits at https://openrouter.ai/settings/credits and retry'
  }
  if (status === 401) {
    return 'Check that your OPENROUTER_API_KEY is valid and has audio generation access'
  }
  if (status === 429 || lowerMessage.includes('quota') || lowerMessage.includes('rate limit')) {
    return 'You have exceeded your OpenRouter quota or rate limit. Wait before retrying or add credits'
  }
  if (status === 400 && lowerMessage.includes('voice')) {
    return `The voice may not be supported by "${model}". Check the model's supported voices on its OpenRouter page, or omit voice to use OPENROUTER_VOICE_DEFAULT`
  }
  if (status === 404) {
    return `Ensure the audio model "${model}" exists and is available on OpenRouter`
  }
  if (status >= 500) {
    return 'The audio provider is temporarily unavailable. Retry after a few moments'
  }
  if (lowerMessage.includes('unauthorized') || lowerMessage.includes('401')) {
    return 'Check that your OPENROUTER_API_KEY is valid and has audio generation access'
  }
  if (
    lowerMessage.includes('404') ||
    lowerMessage.includes('model') ||
    lowerMessage.includes('not found')
  ) {
    return `Ensure the audio model "${model}" exists and is available on OpenRouter`
  }
  return 'Check OpenRouter API configuration and try again'
}

/**
 * Extracts the human-readable message from OpenRouter's error envelope
 * (`{"error":{"code","message"}}`), falling back to the raw text.
 */
function extractUpstreamMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } }
    const message = parsed?.error?.message
    if (typeof message === 'string' && message.length > 0) {
      return message
    }
  } catch {
    // not JSON; use the raw text
  }
  return text
}

interface HttpErrorOptions {
  model: string
  stage: string
  /** Overrides the status-derived suggestion. */
  suggestion?: string
}

/**
 * Builds an `AudioAPIError` from a non-OK response, carrying `statusCode`
 * and the upstream message (sanitized before it reaches the wire by
 * `responseBuilder`).
 */
export async function buildHttpError(
  response: Response,
  options: HttpErrorOptions
): Promise<AudioAPIError> {
  let upstreamMessage = `HTTP ${response.status}`
  try {
    const text = await response.text()
    if (text) {
      upstreamMessage = extractUpstreamMessage(text)
    }
  } catch {
    // ignore body read failures; status is enough
  }

  return new AudioAPIError(
    `OpenRouter audio API request failed (HTTP ${response.status})`,
    {
      provider: 'openrouter',
      model: options.model,
      stage: options.stage,
      upstreamMessage,
      suggestion:
        options.suggestion ??
        getAPIErrorSuggestion(response.status, upstreamMessage, options.model),
    },
    response.status
  )
}
