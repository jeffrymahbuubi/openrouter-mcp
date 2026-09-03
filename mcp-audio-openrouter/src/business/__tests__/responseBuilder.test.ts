/**
 * Test suite for ResponseBuilder
 * Tests structured content response generation for both success and error cases
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { GeneratedMusicResult, GeneratedVoiceResult } from '../../api/audioClient'
import {
  AudioAPIError,
  FileOperationError,
  InputValidationError,
  NetworkError,
} from '../../utils/errors'
import { createResponseBuilder, type ResponseBuilder } from '../responseBuilder'

describe('ResponseBuilder', () => {
  let responseBuilder: ResponseBuilder

  beforeEach(() => {
    responseBuilder = createResponseBuilder()
  })

  describe('buildVoiceSuccessResponse', () => {
    it('should create file URI structured content response with transcript', () => {
      const generationResult: GeneratedVoiceResult = {
        audioData: Buffer.from('fake-audio-data'),
        metadata: {
          model: 'openai/gpt-audio',
          provider: 'openrouter',
          prompt: 'Say hello',
          mimeType: 'audio/wav',
          timestamp: new Date('2026-09-01T12:00:00Z'),
          voice: 'alloy',
          transcript: 'Hello there',
        },
      }
      const testFilePath = '/path/to/voice-123.wav'

      const response = responseBuilder.buildVoiceSuccessResponse(generationResult, testFilePath)

      expect(response.isError).toBe(false)
      expect(response.content).toHaveLength(1)
      expect(response.content[0]?.type).toBe('text')

      const contentData = JSON.parse(response.content[0]?.text ?? '{}')
      expect(contentData.type).toBe('resource')
      expect(contentData.resource.uri).toBe('file:///path/to/voice-123.wav')
      expect(contentData.resource.name).toBe('voice-123.wav')
      expect(contentData.resource.mimeType).toBe('audio/wav')
      expect(contentData.metadata.model).toBe('openai/gpt-audio')
      expect(contentData.metadata.voice).toBe('alloy')
      expect(contentData.metadata.transcript).toBe('Hello there')
      expect(contentData.metadata.format).toBe('wav')
    })

    it('should report format mp3 for audio/mpeg mime type', () => {
      const generationResult: GeneratedVoiceResult = {
        audioData: Buffer.from('fake-audio-data'),
        metadata: {
          model: 'openai/gpt-audio',
          provider: 'openrouter',
          prompt: 'Say hello',
          mimeType: 'audio/mpeg',
          timestamp: new Date('2026-09-01T12:00:00Z'),
          voice: 'nova',
          transcript: 'Hi',
        },
      }

      const response = responseBuilder.buildVoiceSuccessResponse(
        generationResult,
        '/path/to/voice.mp3'
      )
      const contentData = JSON.parse(response.content[0]?.text ?? '{}')
      expect(contentData.metadata.format).toBe('mp3')
      expect(contentData.resource.mimeType).toBe('audio/mpeg')
    })
  })

  describe('buildMusicSuccessResponse', () => {
    it('should create file URI structured content response with length metadata', () => {
      const generationResult: GeneratedMusicResult = {
        audioData: Buffer.from('fake-audio-data'),
        metadata: {
          model: 'google/lyria-3-clip-preview',
          provider: 'openrouter',
          prompt: 'lofi chiptune',
          mimeType: 'audio/wav',
          timestamp: new Date('2026-09-01T12:00:00Z'),
          length: 'clip',
        },
      }

      const response = responseBuilder.buildMusicSuccessResponse(
        generationResult,
        '/path/to/music-123.wav'
      )

      expect(response.isError).toBe(false)
      const contentData = JSON.parse(response.content[0]?.text ?? '{}')
      expect(contentData.type).toBe('resource')
      expect(contentData.resource.name).toBe('music-123.wav')
      expect(contentData.metadata.length).toBe('clip')
      expect(contentData.metadata.prompt).toBe('lofi chiptune')
      // No transcript concept for music.
      expect(contentData.metadata.transcript).toBeUndefined()
    })
  })

  describe('buildErrorResponse', () => {
    it('should create error response for InputValidationError', () => {
      const error = new InputValidationError('Invalid prompt provided', 'Please provide a prompt')

      const response = responseBuilder.buildErrorResponse(error)

      expect(response.isError).toBe(true)
      const errorData = JSON.parse(response.content[0]?.text ?? '{}')
      expect(errorData.error.code).toBe('INPUT_VALIDATION_ERROR')
      expect(errorData.error.message).toBe('Invalid prompt provided')
    })

    it('should create error response for FileOperationError', () => {
      const error = new FileOperationError('Failed to save audio file')

      const response = responseBuilder.buildErrorResponse(error)

      expect(response.isError).toBe(true)
      const errorData = JSON.parse(response.content[0]?.text ?? '{}')
      expect(errorData.error.code).toBe('FILE_OPERATION_ERROR')
    })

    it('should create error response for AudioAPIError and expose safe details', () => {
      const error = new AudioAPIError('Failed to generate audio with OpenRouter', {
        provider: 'openrouter',
        prompt: 'a song about cats',
        upstreamMessage: 'content policy violation',
        suggestion: 'Rephrase the prompt',
      })

      const response = responseBuilder.buildErrorResponse(error)
      const errorData = JSON.parse(response.content[0]?.text ?? '{}')

      expect(errorData.error.code).toBe('AUDIO_API_ERROR')
      expect(errorData.error.details.provider).toBe('openrouter')
      expect(errorData.error.details.upstreamMessage).toContain('content policy violation')
      expect(errorData.error.details.prompt).toBeUndefined()
    })

    it('should redact API keys from upstreamMessage in details', () => {
      const error = new AudioAPIError('Failed to generate audio with OpenRouter', {
        provider: 'openrouter',
        upstreamMessage: 'Auth failed for OPENROUTER_API_KEY=sk-or-ABCDEF123456789',
      })

      const response = responseBuilder.buildErrorResponse(error)
      const errorData = JSON.parse(response.content[0]?.text ?? '{}')

      expect(errorData.error.details.upstreamMessage).toContain('[REDACTED]')
      expect(errorData.error.details.upstreamMessage).not.toContain('sk-or-ABCDEF123456789')
    })

    it('should create error response for NetworkError', () => {
      const error = new NetworkError('Network connection failed', 'Check your internet connection')

      const response = responseBuilder.buildErrorResponse(error)

      expect(response.isError).toBe(true)
      const errorData = JSON.parse(response.content[0]?.text ?? '{}')
      expect(errorData.error.code).toBe('NETWORK_ERROR')
    })

    it('should handle unknown errors gracefully', () => {
      const error = new Error('Unknown error')

      const response = responseBuilder.buildErrorResponse(error)

      expect(response.isError).toBe(true)
      const errorData = JSON.parse(response.content[0]?.text ?? '{}')
      expect(errorData.error.code).toBe('UNKNOWN_ERROR')
    })
  })
})
