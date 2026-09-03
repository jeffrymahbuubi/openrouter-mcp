/**
 * Test suite for FileManager
 * Tests file operations including saving audio and directory management
 */

import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileOperationError } from '../../utils/errors'
import { createFileManager, type FileManager } from '../fileManager'

describe('FileManager', () => {
  let fileManager: FileManager
  const testOutputDir = path.join(process.cwd(), 'tmp', 'test-output')
  const testAudioData = Buffer.from('fake-audio-data')

  beforeEach(() => {
    fileManager = createFileManager()
  })

  afterEach(async () => {
    try {
      await fs.rm(testOutputDir, { recursive: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('saveAudio', () => {
    it('should save audio data to specified path successfully', async () => {
      const outputPath = path.join(testOutputDir, 'test-voice.wav')

      const result = await fileManager.saveAudio(testAudioData, outputPath)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe(outputPath)
        const savedData = await fs.readFile(outputPath)
        expect(savedData).toEqual(testAudioData)
      }
    })

    it('should create directory automatically if it does not exist', async () => {
      const nestedPath = path.join(testOutputDir, 'nested', 'deep', 'test-music.wav')

      const result = await fileManager.saveAudio(testAudioData, nestedPath)

      expect(result.success).toBe(true)
      if (result.success) {
        const savedData = await fs.readFile(nestedPath)
        expect(savedData).toEqual(testAudioData)
      }
    })

    it('should return FileOperationError when save fails due to invalid path', async () => {
      const invalidPath = '/invalid/\0/path/test.wav'

      const result = await fileManager.saveAudio(testAudioData, invalidPath)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(FileOperationError)
        expect(result.error.code).toBe('FILE_OPERATION_ERROR')
        expect(result.error.message).toContain('Failed to create directory')
      }
    })
  })

  describe('ensureDirectoryExists', () => {
    it('should create directory successfully if it does not exist', () => {
      const newDirPath = path.join(testOutputDir, 'new-directory')

      const result = fileManager.ensureDirectoryExists(newDirPath)

      expect(result.success).toBe(true)
    })

    it('should succeed if directory already exists', async () => {
      await fs.mkdir(testOutputDir, { recursive: true })

      const result = fileManager.ensureDirectoryExists(testOutputDir)

      expect(result.success).toBe(true)
    })

    it('should return error for invalid directory path', () => {
      const invalidPath = '/invalid/\0/directory'

      const result = fileManager.ensureDirectoryExists(invalidPath)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toBeInstanceOf(FileOperationError)
        expect(result.error.code).toBe('FILE_OPERATION_ERROR')
      }
    })
  })

  describe('generateFileName', () => {
    it('should return voice-prefixed .wav filename by default', () => {
      const fileName = fileManager.generateFileName('voice')

      expect(fileName).toMatch(/^voice-\d{13}-[0-9a-f]{8}\.wav$/)
    })

    it('should return music-prefixed .wav filename by default', () => {
      const fileName = fileManager.generateFileName('music')

      expect(fileName).toMatch(/^music-\d{13}-[0-9a-f]{8}\.wav$/)
    })

    it('should return .mp3 extension when mimeType is audio/mpeg', () => {
      const fileName = fileManager.generateFileName('voice', 'audio/mpeg')

      expect(fileName).toMatch(/^voice-\d{13}-[0-9a-f]{8}\.mp3$/)
    })

    it('should return .wav extension as fallback for unknown mimeType', () => {
      const fileName = fileManager.generateFileName('music', 'audio/unknown')

      expect(fileName).toMatch(/^music-\d{13}-[0-9a-f]{8}\.wav$/)
    })
  })
})
