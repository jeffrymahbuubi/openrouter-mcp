/**
 * Centralized MIME type and file extension mapping utility for audio.
 * Single source of truth for all MIME type and extension operations.
 */

import * as path from 'node:path'
import { Logger } from './logger.js'

const logger = new Logger()

/**
 * MIME type to file extension mapping.
 * Primary extension is used for each MIME type.
 */
const MIME_TO_EXTENSION: ReadonlyMap<string, string> = new Map([
  ['audio/wav', '.wav'],
  ['audio/mpeg', '.mp3'],
])

/**
 * File extension to MIME type mapping.
 * Includes aliases (e.g., .wave -> audio/wav).
 */
const EXTENSION_TO_MIME: ReadonlyMap<string, string> = new Map([
  ['.wav', 'audio/wav'],
  ['.wave', 'audio/wav'],
  ['.mp3', 'audio/mpeg'],
])

export const DEFAULT_MIME_TYPE = 'audio/wav'
const DEFAULT_EXTENSION = '.wav'

/**
 * All supported MIME types for audio processing.
 */
export const SUPPORTED_MIME_TYPES: readonly string[] = [...MIME_TO_EXTENSION.keys()]

/**
 * All supported file extensions for audio processing.
 * Includes aliases (e.g., both .wav and .wave).
 */
export const SUPPORTED_EXTENSIONS: readonly string[] = [...EXTENSION_TO_MIME.keys()]

/**
 * Get the file extension for a given MIME type.
 * Returns .wav with a warning log for unknown MIME types.
 *
 * @param mimeType - The MIME type string (e.g., "audio/mpeg")
 * @returns The corresponding file extension (e.g., ".mp3")
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const extension = MIME_TO_EXTENSION.get(mimeType)
  if (extension) {
    return extension
  }

  logger.warn('mimeUtils', `Unknown MIME type encountered, falling back to ${DEFAULT_EXTENSION}`, {
    mimeType,
  })
  return DEFAULT_EXTENSION
}

/**
 * Get the MIME type for a given file extension.
 * Returns audio/wav for unknown extensions.
 *
 * @param ext - The file extension (e.g., ".mp3")
 * @returns The corresponding MIME type (e.g., "audio/mpeg")
 */
export function getMimeTypeFromExtension(ext: string): string {
  const normalized = ext.toLowerCase()
  return EXTENSION_TO_MIME.get(normalized) ?? DEFAULT_MIME_TYPE
}

/**
 * Normalize a MIME type against the supported allowlist.
 * Returns the MIME type as-is if supported, otherwise falls back to audio/wav with a warning.
 *
 * @param mimeType - The MIME type to normalize
 * @returns A supported MIME type string
 */
export function normalizeMimeType(mimeType: string): string {
  if (MIME_TO_EXTENSION.has(mimeType)) {
    return mimeType
  }
  logger.warn('mimeUtils', `Unknown MIME type, normalizing to ${DEFAULT_MIME_TYPE}`, { mimeType })
  return DEFAULT_MIME_TYPE
}

/**
 * Map an `AudioFormat` ('wav' | 'mp3') to its MIME type.
 */
export function mimeTypeForFormat(format: 'wav' | 'mp3'): string {
  return format === 'mp3' ? 'audio/mpeg' : 'audio/wav'
}

/**
 * Ensure a filename has an appropriate file extension based on MIME type.
 * - If the filename already has an extension (any extension), it is preserved as-is.
 * - If the filename has no extension, one is appended based on the MIME type.
 *
 * @param fileName - The filename, with or without extension
 * @param mimeType - The MIME type to derive the extension from
 * @returns The filename with an appropriate extension
 */
export function ensureExtension(fileName: string, mimeType: string): string {
  const ext = path.extname(fileName)
  if (ext) {
    return fileName
  }

  const newExt = getExtensionFromMimeType(mimeType)
  return `${fileName}${newExt}`
}
