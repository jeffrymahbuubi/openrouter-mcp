/**
 * Tests for ErrorHandler utility
 * Covers unified error handling and Result type wrapping
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AudioAPIError,
  FileOperationError,
  InputValidationError,
  NetworkError,
} from '../../utils/errors'
import { ErrorHandler } from '../errorHandler'

vi.mock('../../utils/logger', () => ({
  Logger: class {
    error = vi.fn()
    warn = vi.fn()
    info = vi.fn()
  },
  sanitizeText: (input: string) => input,
}))

describe('ErrorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleError', () => {
    it('should handle InputValidationError correctly', () => {
      const error = new InputValidationError('Prompt is too long', 'Shorten your prompt')

      const response = ErrorHandler.handleError(error)

      expect(response).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('"INPUT_VALIDATION_ERROR"') }],
      })
      expect(response.content[0]?.text).toContain('Prompt is too long')
    })

    it('should handle AudioAPIError correctly', () => {
      const error = new AudioAPIError('API quota exceeded', 'Wait or add credits', 429)

      const response = ErrorHandler.handleError(error)

      expect(response).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('"AUDIO_API_ERROR"') }],
      })
      expect(response.content[0]?.text).toContain('API quota exceeded')
    })

    it('should handle NetworkError correctly', () => {
      const error = new NetworkError('Network request failed', 'Check connection', new Error('x'))

      const response = ErrorHandler.handleError(error)

      expect(response).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('"NETWORK_ERROR"') }],
      })
    })

    it('should handle FileOperationError correctly', () => {
      const error = new FileOperationError('Failed to save audio: Permission denied')

      const response = ErrorHandler.handleError(error)

      expect(response.content[0]?.text).toContain('"FILE_OPERATION_ERROR"')
    })

    it('should handle unknown Error types', () => {
      const error = new Error('Unknown error occurred')

      const response = ErrorHandler.handleError(error)

      expect(response.content[0]?.text).toContain('"INTERNAL_ERROR"')
      expect(response.content[0]?.text).toContain('Contact system administrator')
    })

    it('should produce valid JSON in response content', () => {
      const error = new InputValidationError('Test error', 'Test suggestion')

      const response = ErrorHandler.handleError(error)

      expect(() => JSON.parse(response.content[0]?.text ?? '')).not.toThrow()
    })
  })

  describe('wrapWithResultType', () => {
    it('should return Ok result for successful operation', async () => {
      const successOperation = vi.fn().mockResolvedValue('success result')

      const result = await ErrorHandler.wrapWithResultType(successOperation)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value).toBe('success result')
      }
    })

    it('should return Err result for failed operation', async () => {
      const error = new Error('Operation failed')
      const failedOperation = vi.fn().mockRejectedValue(error)

      const result = await ErrorHandler.wrapWithResultType(failedOperation)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe(error)
      }
    })

    it('should handle non-Error thrown values', async () => {
      const failedOperation = vi.fn().mockRejectedValue('string error')

      const result = await ErrorHandler.wrapWithResultType(failedOperation)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error)
        expect(result.error.message).toBe('Unknown error')
      }
    })
  })
})
