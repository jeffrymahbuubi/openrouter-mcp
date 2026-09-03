/**
 * Tests for mimeUtils utility
 * Covers MIME-to-extension mapping, extension-to-MIME mapping,
 * extension detection, and extension ensurance for audio filenames
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensureExtension,
  getExtensionFromMimeType,
  getMimeTypeFromExtension,
  mimeTypeForFormat,
  normalizeMimeType,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_MIME_TYPES,
} from '../mimeUtils'

describe('mimeUtils', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('SUPPORTED_MIME_TYPES', () => {
    it('should contain both supported MIME types', () => {
      expect(SUPPORTED_MIME_TYPES).toContain('audio/wav')
      expect(SUPPORTED_MIME_TYPES).toContain('audio/mpeg')
      expect(SUPPORTED_MIME_TYPES).toHaveLength(2)
    })
  })

  describe('SUPPORTED_EXTENSIONS', () => {
    it('should contain all supported extensions', () => {
      expect(SUPPORTED_EXTENSIONS).toContain('.wav')
      expect(SUPPORTED_EXTENSIONS).toContain('.wave')
      expect(SUPPORTED_EXTENSIONS).toContain('.mp3')
    })
  })

  describe('getExtensionFromMimeType', () => {
    it('should map audio/wav to .wav', () => {
      expect(getExtensionFromMimeType('audio/wav')).toBe('.wav')
    })

    it('should map audio/mpeg to .mp3', () => {
      expect(getExtensionFromMimeType('audio/mpeg')).toBe('.mp3')
    })

    it('should return .wav with warning log for unknown MIME type', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = getExtensionFromMimeType('audio/ogg')

      expect(result).toBe('.wav')
      expect(consoleErrorSpy).toHaveBeenCalled()
      const logOutput = consoleErrorSpy.mock.calls[0]?.[0] as string
      expect(logOutput).toContain('warn')
      expect(logOutput).toContain('audio/ogg')
    })
  })

  describe('getMimeTypeFromExtension', () => {
    it('should map .wav to audio/wav', () => {
      expect(getMimeTypeFromExtension('.wav')).toBe('audio/wav')
    })

    it('should map .mp3 to audio/mpeg', () => {
      expect(getMimeTypeFromExtension('.mp3')).toBe('audio/mpeg')
    })

    it('should return audio/wav for unknown extension', () => {
      expect(getMimeTypeFromExtension('.ogg')).toBe('audio/wav')
    })
  })

  describe('mimeTypeForFormat', () => {
    it('should map wav to audio/wav', () => {
      expect(mimeTypeForFormat('wav')).toBe('audio/wav')
    })

    it('should map mp3 to audio/mpeg', () => {
      expect(mimeTypeForFormat('mp3')).toBe('audio/mpeg')
    })
  })

  describe('ensureExtension', () => {
    it('should add extension when filename has none', () => {
      expect(ensureExtension('narration', 'audio/wav')).toBe('narration.wav')
    })

    it('should preserve existing extension', () => {
      expect(ensureExtension('narration.mp3', 'audio/wav')).toBe('narration.mp3')
    })

    it('should add extension for audio/mpeg when filename has no extension', () => {
      expect(ensureExtension('theme-song', 'audio/mpeg')).toBe('theme-song.mp3')
    })
  })

  describe('normalizeMimeType', () => {
    it('should return supported MIME type as-is', () => {
      expect(normalizeMimeType('audio/wav')).toBe('audio/wav')
      expect(normalizeMimeType('audio/mpeg')).toBe('audio/mpeg')
    })

    it('should return audio/wav for unknown MIME type', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = normalizeMimeType('audio/ogg')

      expect(result).toBe('audio/wav')
      expect(consoleErrorSpy).toHaveBeenCalled()
    })
  })
})
