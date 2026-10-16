/**
 * Tests for AudioAPIError suggestion getter
 */

import { describe, expect, it } from 'vitest'
import { AudioAPIError, TimeoutError } from '../errors'

describe('AudioAPIError', () => {
  describe('suggestion getter', () => {
    it('should suggest checking the OPENROUTER_API_KEY for auth errors', () => {
      const error = new AudioAPIError('Unauthorized: authentication failed')

      expect(error.suggestion).toContain('OPENROUTER_API_KEY')
    })

    it('should suggest waiting/adding credits for rate limit errors', () => {
      const error = new AudioAPIError('429 rate limit exceeded')

      expect(error.suggestion).toContain('quota')
    })

    it('should reference model availability for model-related errors', () => {
      const error = new AudioAPIError('model access denied')

      expect(error.suggestion).toContain('available to your account')
    })

    it('should use custom suggestion when provided as second string arg', () => {
      const customSuggestion = 'Custom suggestion text'
      const error = new AudioAPIError('Some error', customSuggestion)

      expect(error.suggestion).toBe(customSuggestion)
    })

    it('should use context.suggestion when provided', () => {
      const error = new AudioAPIError('Some error', {
        provider: 'openrouter',
        suggestion: 'From context',
      })

      expect(error.suggestion).toBe('From context')
    })

    it('should expose statusCode when provided', () => {
      const error = new AudioAPIError('boom', { provider: 'openrouter' }, 401)

      expect((error as unknown as { statusCode?: number }).statusCode).toBe(401)
    })
  })
})

describe('TimeoutError', () => {
  it('carries TIMEOUT_ERROR, timeoutMs context and a retry/shorten suggestion', () => {
    const error = new TimeoutError('Audio request timed out', 120000)

    expect(error.code).toBe('TIMEOUT_ERROR')
    expect(error.context?.['timeoutMs']).toBe(120000)
    expect(error.suggestion).toContain('120000')
    expect(error.suggestion.toLowerCase()).toContain('shorten')
  })
})
