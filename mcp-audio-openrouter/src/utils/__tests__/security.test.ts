/**
 * Tests for Security Manager
 * Covers file path sanitization, validation, and security checks
 */

import * as path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { SecurityError } from '../errors'
import { SecurityManager } from '../security'

describe('SecurityManager', () => {
  let securityManager: SecurityManager

  beforeEach(() => {
    securityManager = new SecurityManager()
  })

  describe('file path sanitization', () => {
    it('should sanitize valid relative path', () => {
      const inputPath = './output/voice.wav'

      const result = securityManager.sanitizeFilePath(inputPath)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toContain('output')
        expect(result.data).toContain('voice.wav')
      }
    })

    it('should reject path with null byte', () => {
      const inputPath = './output/voice.wav\0'

      const result = securityManager.sanitizeFilePath(inputPath)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(SecurityError)
        expect(result.error.message).toContain('Null byte detected')
        expect(result.error.code).toBe('SECURITY_ERROR')
      }
    })

    it('should reject path traversal attempt with ../', () => {
      const inputPath = '../../../etc/passwd'

      const result = securityManager.sanitizeFilePath(inputPath)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(SecurityError)
        expect(result.error.message).toContain('Path traversal attempt')
      }
    })

    it('should reject path outside allowed directories', () => {
      const inputPath = '/var/log/system.log'

      const result = securityManager.sanitizeFilePath(inputPath)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(SecurityError)
        expect(result.error.message).toContain('File path outside allowed directories')
      }
    })

    it('should allow path within current working directory', () => {
      const inputPath = './temp/output.wav'

      const result = securityManager.sanitizeFilePath(inputPath)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toContain(process.cwd())
      }
    })

    it('should allow path within temp directory', () => {
      const tempPath = path.join('/tmp', 'test-audio.wav')

      const result = securityManager.sanitizeFilePath(tempPath)

      expect(result.success).toBe(true)
      if (result.success) {
        // Compare against the resolved form: on Windows, `path.resolve('/tmp/...')`
        // adds the current drive letter, so the raw joined path isn't a byte-for-byte match.
        expect(result.data).toBe(path.resolve(tempPath))
      }
    })
  })

  describe('audio file validation', () => {
    it('should validate WAV file extension', () => {
      expect(securityManager.validateAudioFile('./output/voice.wav').success).toBe(true)
    })

    it('should validate MP3 file extension', () => {
      expect(securityManager.validateAudioFile('./output/music.mp3').success).toBe(true)
    })

    it('should reject unsupported file extension', () => {
      const result = securityManager.validateAudioFile('./output/document.pdf')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(SecurityError)
        expect(result.error.message).toContain('Unsupported file extension: .pdf')
      }
    })

    it('should handle case insensitive extensions', () => {
      expect(securityManager.validateAudioFile('./output/VOICE.WAV').success).toBe(true)
    })

    it('should reject files without extensions', () => {
      const result = securityManager.validateAudioFile('./output/audiofile')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain('Unsupported file extension:')
      }
    })
  })

  describe('security error handling', () => {
    it('should provide helpful error messages for null byte attacks', () => {
      const result = securityManager.sanitizeFilePath('voice.wav\0.exe')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toBe('Null byte detected in file path')
        expect(result.error.suggestion).toBe('Ensure your request meets security requirements')
      }
    })

    it('should provide helpful error messages for path traversal', () => {
      const result = securityManager.sanitizeFilePath('../sensitive/file.txt')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toBe('Path traversal attempt detected')
        expect(result.error.suggestion).toBe('Use valid file paths within allowed directories only')
      }
    })
  })
})
