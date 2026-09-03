/**
 * File Manager for handling audio file operations
 * Provides functionality for saving audio and managing directories
 */

import { randomBytes } from 'node:crypto'
import { promises as fs, mkdirSync } from 'node:fs'
import * as path from 'node:path'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import { FileOperationError } from '../utils/errors.js'
import { DEFAULT_MIME_TYPE, getExtensionFromMimeType } from '../utils/mimeUtils.js'

// Constants for file naming and error messages
const RANDOM_BYTES_LENGTH = 4 as const

const ERROR_MESSAGES = {
  SAVE_FAILED: 'Failed to save audio file',
  DIRECTORY_CREATION_FAILED: 'Failed to create directory',
} as const

/** Filename prefix identifying which tool produced the file. */
export type AudioFilePrefix = 'voice' | 'music'

/**
 * Interface for file management operations
 */
export interface FileManager {
  saveAudio(audioData: Buffer, outputPath: string): Promise<Result<string, FileOperationError>>
  ensureDirectoryExists(dirPath: string): Result<void, FileOperationError>
  generateFileName(prefix: AudioFilePrefix, mimeType?: string): string
}

/**
 * Ensures that the specified directory exists, creating it if necessary
 * @param dirPath Path to the directory
 * @returns Result indicating success or failure
 */
function ensureDirectoryExists(dirPath: string): Result<void, FileOperationError> {
  try {
    // Use mkdirSync with recursive option to create all necessary parent directories
    mkdirSync(dirPath, { recursive: true })
    return Ok(undefined)
  } catch (error) {
    return Err(
      new FileOperationError(
        `${ERROR_MESSAGES.DIRECTORY_CREATION_FAILED}: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    )
  }
}

/**
 * Generates a unique filename based on prefix, timestamp and random component
 * @param prefix 'voice' or 'music', identifying which tool produced the file
 * @param mimeType Optional MIME type to determine file extension (defaults to audio/wav)
 * @returns Generated filename in the format: {prefix}-{timestamp}-{hex}.{ext}
 */
function generateFileName(prefix: AudioFilePrefix, mimeType?: string): string {
  const timestamp = Date.now()
  const random = randomBytes(RANDOM_BYTES_LENGTH).toString('hex')
  const extension = getExtensionFromMimeType(mimeType ?? DEFAULT_MIME_TYPE)
  return `${prefix}-${timestamp}-${random}${extension}`
}

/**
 * Creates a file manager for audio file operations
 * @returns FileManager implementation
 */
export function createFileManager(): FileManager {
  return {
    /**
     * Saves audio data to the specified file path
     * @param audioData Buffer containing the audio data
     * @param outputPath Absolute path where the audio should be saved
     * @returns Result containing the saved file path or an error
     */
    async saveAudio(
      audioData: Buffer,
      outputPath: string
    ): Promise<Result<string, FileOperationError>> {
      try {
        // Ensure the directory exists
        const directory = path.dirname(outputPath)
        const dirResult = ensureDirectoryExists(directory)
        if (!dirResult.success) {
          return Err(dirResult.error)
        }

        // Save the file
        await fs.writeFile(outputPath, audioData)

        return Ok(outputPath)
      } catch (error) {
        return Err(
          new FileOperationError(
            `${ERROR_MESSAGES.SAVE_FAILED}: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        )
      }
    },

    ensureDirectoryExists,
    generateFileName,
  }
}
