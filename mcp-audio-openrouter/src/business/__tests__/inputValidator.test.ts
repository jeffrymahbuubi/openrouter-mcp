import { describe, expect, it } from 'vitest'
import type { GenerateMusicParams, GenerateVoiceParams } from '../../types/mcp'
import {
  validateGenerateMusicParams,
  validateGenerateVoiceParams,
  validatePrompt,
} from '../inputValidator'

describe('inputValidator', () => {
  describe('validatePrompt', () => {
    it('should return error for empty prompt', () => {
      const result = validatePrompt('')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('INPUT_VALIDATION_ERROR')
        expect(result.error.message).toContain('Prompt must be between 1 and 4000 characters')
      }
    })

    it('should return error for prompt exceeding 4000 characters', () => {
      const result = validatePrompt('a'.repeat(4001))

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('INPUT_VALIDATION_ERROR')
      }
    })

    it('should return success for valid prompt', () => {
      const result = validatePrompt('Say hello in a warm tone')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe('Say hello in a warm tone')
      }
    })
  })

  describe('validateGenerateVoiceParams', () => {
    it('should return error for invalid params (empty prompt)', () => {
      const invalidParams: GenerateVoiceParams = { prompt: '' }

      const result = validateGenerateVoiceParams(invalidParams)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain('Prompt must be between 1 and 4000 characters')
      }
    })

    it('should return success for valid params', () => {
      const validParams: GenerateVoiceParams = { prompt: 'Say hello' }

      const result = validateGenerateVoiceParams(validParams)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(validParams)
      }
    })

    it('should accept all supported voices', () => {
      const voices: GenerateVoiceParams['voice'][] = [
        'alloy',
        'echo',
        'fable',
        'onyx',
        'nova',
        'shimmer',
      ]
      for (const voice of voices) {
        const result = validateGenerateVoiceParams({ prompt: 'hi', voice })
        expect(result.success).toBe(true)
      }
    })

    it('should reject an invalid voice', () => {
      const result = validateGenerateVoiceParams({
        prompt: 'hi',
        voice: 'robot' as unknown as GenerateVoiceParams['voice'],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain('Invalid voice')
      }
    })

    it('should accept both supported formats', () => {
      expect(validateGenerateVoiceParams({ prompt: 'hi', format: 'wav' }).success).toBe(true)
      expect(validateGenerateVoiceParams({ prompt: 'hi', format: 'mp3' }).success).toBe(true)
    })

    it('should reject an invalid format', () => {
      const result = validateGenerateVoiceParams({
        prompt: 'hi',
        format: 'ogg' as unknown as GenerateVoiceParams['format'],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain('Invalid format')
      }
    })
  })

  describe('validateGenerateMusicParams', () => {
    it('should return error for invalid params (empty prompt)', () => {
      const result = validateGenerateMusicParams({ prompt: '' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain('Prompt must be between 1 and 4000 characters')
      }
    })

    it('should return success for valid params', () => {
      const validParams: GenerateMusicParams = { prompt: 'lofi chiptune, C major' }

      const result = validateGenerateMusicParams(validParams)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual(validParams)
      }
    })

    it('should accept both length presets', () => {
      expect(validateGenerateMusicParams({ prompt: 'x', length: 'clip' }).success).toBe(true)
      expect(validateGenerateMusicParams({ prompt: 'x', length: 'long' }).success).toBe(true)
    })

    it('should reject an invalid length preset', () => {
      const result = validateGenerateMusicParams({
        prompt: 'x',
        length: 'epic' as unknown as GenerateMusicParams['length'],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain('Invalid length')
      }
    })

    it('should reject an invalid format', () => {
      const result = validateGenerateMusicParams({
        prompt: 'x',
        format: 'flac' as unknown as GenerateMusicParams['format'],
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain('Invalid format')
      }
    })
  })
})
