/**
 * Tests for GeminiAPIError suggestion getter
 * Verifies model name references in suggestion text for multi-model support
 */

import { describe, expect, it } from 'vitest'
import { GeminiAPIError, TimeoutError } from '../errors'

describe('GeminiAPIError', () => {
  describe('suggestion getter', () => {
    it('should reference both models when message contains model/access/permission keywords', () => {
      // Arrange
      const error = new GeminiAPIError('Model not found or access denied')

      // Act
      const suggestion = error.suggestion

      // Assert - should mention both models
      expect(suggestion).toContain('google/gemini-3.1-flash-image')
      expect(suggestion).toContain('google/gemini-3-pro-image')
    })

    it('should not contain only a single hardcoded model name for model-related errors', () => {
      // Arrange
      const error = new GeminiAPIError('Permission denied for model access')

      // Act
      const suggestion = error.suggestion

      // Assert - suggestion should reference both models, not just one
      expect(suggestion).toMatch(/google\/gemini-3\.1-flash-image/)
      expect(suggestion).toMatch(/google\/gemini-3-pro-image/)
    })

    it('should use custom suggestion when provided', () => {
      // Arrange
      const customSuggestion = 'Custom suggestion text'
      const error = new GeminiAPIError('Some error', customSuggestion)

      // Act & Assert
      expect(error.suggestion).toBe(customSuggestion)
    })
  })
})

describe('TimeoutError', () => {
  it('carries TIMEOUT_ERROR, timeoutMs context and an actionable suggestion', () => {
    const error = new TimeoutError('Image request timed out', 30000)

    expect(error.code).toBe('TIMEOUT_ERROR')
    expect(error.context?.['timeoutMs']).toBe(30000)
    expect(error.suggestion).toContain('OPENROUTER_IMAGE_TIMEOUT_MS')
    expect(error.suggestion).toContain('30000')
  })
})
