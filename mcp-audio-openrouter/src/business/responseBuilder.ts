/**
 * Response Builder for MCP structured content responses
 * Converts generation results and errors into MCP-compatible response format
 */

import * as path from 'node:path'
import type { GeneratedMusicResult, GeneratedVoiceResult } from '../api/audioClient.js'
import type {
  McpToolResponse,
  MusicStructuredContent,
  VoiceStructuredContent,
} from '../types/mcp.js'
import {
  AudioAPIError,
  type BaseError,
  ConfigError,
  FileOperationError,
  InputValidationError,
  NetworkError,
  SecurityError,
} from '../utils/errors.js'
import { sanitizeText } from '../utils/logger.js'
import { getMimeTypeFromExtension, SUPPORTED_MIME_TYPES } from '../utils/mimeUtils.js'

const UNKNOWN_ERROR_CODE = 'UNKNOWN_ERROR'
const DEFAULT_ERROR_SUGGESTION = 'Please try again or contact support if the problem persists'

/**
 * Context keys safe to surface in MCP error responses. Anything not on this
 * list (notably `prompt`, which the caller already supplied, and any future
 * additions) stays out of the wire format.
 */
const SAFE_CONTEXT_KEYS = ['provider', 'stage', 'statusCode'] as const

/**
 * Project an error's context object into a sanitized subset suitable for
 * inclusion in caller-visible error responses. The upstream API message is
 * passed through the logger's redaction patterns before exposure.
 */
function buildPublicDetails(
  context: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!context) return undefined

  const details: Record<string, unknown> = {}

  for (const key of SAFE_CONTEXT_KEYS) {
    if (context[key] !== undefined) {
      details[key] = context[key]
    }
  }

  if (typeof context['upstreamMessage'] === 'string') {
    details['upstreamMessage'] = sanitizeText(context['upstreamMessage'])
  }

  return Object.keys(details).length > 0 ? details : undefined
}

export interface ResponseBuilder {
  buildVoiceSuccessResponse(
    generationResult: GeneratedVoiceResult,
    filePath: string
  ): McpToolResponse
  buildMusicSuccessResponse(
    generationResult: GeneratedMusicResult,
    filePath: string
  ): McpToolResponse
  buildErrorResponse(error: BaseError | Error): McpToolResponse
}

/**
 * Determines MIME type from generation metadata with extension-based fallback.
 * Uses the API-reported MIME type as the primary source of truth.
 * Falls back to file extension detection when metadata MIME is unavailable.
 */
function resolveMimeType(metadataMimeType: string | undefined, filePath: string): string {
  if (metadataMimeType && SUPPORTED_MIME_TYPES.includes(metadataMimeType)) {
    return metadataMimeType
  }
  const ext = path.extname(filePath).toLowerCase()
  return getMimeTypeFromExtension(ext)
}

/**
 * Converts various error types to structured error format
 */
function convertErrorToStructured(error: BaseError | Error): {
  code: string
  message: string
  suggestion: string
  timestamp: string
  details?: Record<string, unknown>
} {
  const baseError = {
    timestamp: new Date().toISOString(),
  }

  if (
    error instanceof InputValidationError ||
    error instanceof FileOperationError ||
    error instanceof AudioAPIError ||
    error instanceof NetworkError ||
    error instanceof ConfigError ||
    error instanceof SecurityError
  ) {
    const details = buildPublicDetails(error.context)
    return {
      ...baseError,
      code: error.code,
      message: sanitizeText(error.message),
      suggestion: error.suggestion,
      ...(details && { details }),
    }
  }

  // Handle unknown errors
  return {
    ...baseError,
    code: UNKNOWN_ERROR_CODE,
    message: error.message || 'An unknown error occurred',
    suggestion: DEFAULT_ERROR_SUGGESTION,
  }
}

/**
 * Creates a response builder with MCP structured content support
 * @returns ResponseBuilder implementation
 */
export function createResponseBuilder(): ResponseBuilder {
  return {
    /**
     * Builds a successful structured content response for `generate_voice`.
     * The audio file is always saved to disk and referenced by path (never
     * returned inline) — audio clips are large enough (2-20+ MB) that
     * inlining them would blow the ~25,000 token MCP response budget (see
     * docs/SPEC.md D3). `transcript` lets the caller verify what was spoken
     * without playing the file.
     */
    buildVoiceSuccessResponse(
      generationResult: GeneratedVoiceResult,
      filePath: string
    ): McpToolResponse {
      const mimeType = resolveMimeType(generationResult.metadata.mimeType, filePath)
      const fileName = path.basename(filePath)

      const structuredContent: VoiceStructuredContent = {
        type: 'resource',
        resource: {
          uri: `file://${filePath}`,
          name: fileName,
          mimeType,
        },
        metadata: {
          model: generationResult.metadata.model,
          provider: 'openrouter',
          voice: generationResult.metadata.voice,
          format: mimeType === 'audio/mpeg' ? 'mp3' : 'wav',
          endpoint: generationResult.metadata.endpoint,
          ...(generationResult.metadata.generationId && {
            generationId: generationResult.metadata.generationId,
          }),
          ...(generationResult.metadata.endpoint === 'chat_completions' && {
            transcript: generationResult.metadata.transcript,
          }),
          processingTime: 0,
          timestamp: generationResult.metadata.timestamp.toISOString(),
        },
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        isError: false,
      }
    },

    /**
     * Builds a successful structured content response for `generate_music`.
     * Same no-inline-preview rationale as `buildVoiceSuccessResponse`.
     */
    buildMusicSuccessResponse(
      generationResult: GeneratedMusicResult,
      filePath: string
    ): McpToolResponse {
      const mimeType = resolveMimeType(generationResult.metadata.mimeType, filePath)
      const fileName = path.basename(filePath)

      const structuredContent: MusicStructuredContent = {
        type: 'resource',
        resource: {
          uri: `file://${filePath}`,
          name: fileName,
          mimeType,
        },
        metadata: {
          model: generationResult.metadata.model,
          provider: 'openrouter',
          length: generationResult.metadata.length,
          format: mimeType === 'audio/mpeg' ? 'mp3' : 'wav',
          prompt: generationResult.metadata.prompt,
          processingTime: 0,
          timestamp: generationResult.metadata.timestamp.toISOString(),
        },
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        isError: false,
      }
    },

    /**
     * Builds an error response in structured content format
     */
    buildErrorResponse(error: BaseError | Error): McpToolResponse {
      const structuredError = {
        error: convertErrorToStructured(error),
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(structuredError) }],
        isError: true,
      }
    },
  }
}
