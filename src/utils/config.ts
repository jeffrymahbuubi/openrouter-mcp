/**
 * Configuration management for the OpenRouter MCP image server.
 * Handles environment variables and configuration validation.
 *
 * OpenRouter-only (D1): a single provider reached over an OpenAI-compatible
 * endpoint. Image generation uses OpenRouter's dedicated Images API
 * (`POST {baseUrl}/images`); prompt enhancement uses `chat.completions`.
 * See docs/OPENROUTER_API.md for the verified contract.
 */

import type { ImageQuality } from '../types/mcp.js'
import { IMAGE_QUALITY_VALUES } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import { ConfigError } from './errors.js'

/**
 * Configuration interface
 */
export interface Config {
  /** OpenRouter API key (required). */
  openrouterApiKey: string
  /** Base URL for the OpenRouter OpenAI-compatible API. */
  baseUrl: string
  /** Stage-1 prompt-enhancement (text) model. */
  textModel: string
  /** Image model for the `fast` / `balanced` tiers. */
  imageModel: string
  /** Image model for the `quality` tier (falls back to `imageModel` when unset). */
  imageModelHq: string
  /** Optional HTTP-Referer for OpenRouter attribution. */
  appUrl?: string
  /** Optional X-Title for OpenRouter attribution. */
  appTitle?: string
  /** Output directory for generated images (absolute recommended for Claude Desktop). */
  imageOutputDir: string
  /** API timeout in milliseconds. */
  apiTimeout: number
  /** Skip prompt enhancement for direct control. */
  skipPromptEnhancement: boolean
  /** Quality preset controlling image model selection. */
  imageQuality: ImageQuality
}

/**
 * Default configuration values. Model defaults are the tier picks verified on
 * 2026-07-11 (see docs/OPENROUTER_API.md §4).
 */
const DEFAULT_CONFIG = {
  baseUrl: 'https://openrouter.ai/api/v1',
  textModel: 'google/gemini-3.5-flash',
  imageModel: 'google/gemini-3.1-flash-image',
  imageOutputDir: './output',
  apiTimeout: 30000, // 30 seconds
} as const

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  if (!value || value === 'undefined' || value === 'null') {
    return undefined
  }
  return value
}

/**
 * Validates the configuration.
 * @param config The configuration to validate
 * @returns Result containing validated config or ConfigError
 */
export function validateConfig(config: Config): Result<Config, ConfigError> {
  // OPENROUTER_API_KEY is always required (single provider).
  if (!config.openrouterApiKey || config.openrouterApiKey.trim().length === 0) {
    return Err(
      new ConfigError(
        'OPENROUTER_API_KEY is required but not provided',
        'Set OPENROUTER_API_KEY environment variable with your OpenRouter API key (https://openrouter.ai/keys)'
      )
    )
  }

  if (config.openrouterApiKey.length < 10) {
    return Err(
      new ConfigError(
        'OPENROUTER_API_KEY appears to be invalid - must be at least 10 characters',
        'Set the OPENROUTER_API_KEY environment variable to your valid OpenRouter API key'
      )
    )
  }

  // Base URL must be present and non-empty.
  if (!config.baseUrl || config.baseUrl.trim().length === 0) {
    return Err(
      new ConfigError(
        'OPENROUTER_BASE_URL cannot be empty',
        'Leave OPENROUTER_BASE_URL unset to use the default, or set a valid URL'
      )
    )
  }

  // Model identifiers must be present.
  if (!config.textModel || config.textModel.trim().length === 0) {
    return Err(
      new ConfigError(
        'OPENROUTER_TEXT_MODEL cannot be empty',
        'Leave OPENROUTER_TEXT_MODEL unset to use the default, or set a valid model ID'
      )
    )
  }

  if (!config.imageModel || config.imageModel.trim().length === 0) {
    return Err(
      new ConfigError(
        'OPENROUTER_IMAGE_MODEL cannot be empty',
        'Leave OPENROUTER_IMAGE_MODEL unset to use the default, or set a valid model ID'
      )
    )
  }

  // Validate apiTimeout
  if (config.apiTimeout <= 0) {
    return Err(
      new ConfigError(
        'API timeout must be a positive number',
        'Set a positive timeout value in milliseconds (e.g., 30000 for 30 seconds)'
      )
    )
  }

  // Validate imageOutputDir (basic check - non-empty string)
  if (!config.imageOutputDir || config.imageOutputDir.trim().length === 0) {
    return Err(
      new ConfigError(
        'IMAGE_OUTPUT_DIR cannot be empty',
        'Set IMAGE_OUTPUT_DIR to a valid directory path'
      )
    )
  }

  // Validate imageQuality
  if (!IMAGE_QUALITY_VALUES.includes(config.imageQuality)) {
    return Err(
      new ConfigError(
        `Invalid IMAGE_QUALITY value: "${config.imageQuality}". Valid options: ${IMAGE_QUALITY_VALUES.join(', ')}`,
        `Set IMAGE_QUALITY to one of: ${IMAGE_QUALITY_VALUES.join(', ')}`
      )
    )
  }

  return Ok(config)
}

/**
 * Loads configuration from environment variables.
 *
 * `OPENROUTER_IMAGE_MODEL_HQ` falls back to `OPENROUTER_IMAGE_MODEL` when unset.
 * @returns Result containing config or ConfigError
 */
export function getConfig(): Result<Config, ConfigError> {
  const imageModel = readEnv('OPENROUTER_IMAGE_MODEL') || DEFAULT_CONFIG.imageModel
  const appUrl = readEnv('OPENROUTER_APP_URL')
  const appTitle = readEnv('OPENROUTER_APP_TITLE')

  const config: Config = {
    openrouterApiKey: readEnv('OPENROUTER_API_KEY') || '',
    baseUrl: readEnv('OPENROUTER_BASE_URL') || DEFAULT_CONFIG.baseUrl,
    textModel: readEnv('OPENROUTER_TEXT_MODEL') || DEFAULT_CONFIG.textModel,
    imageModel,
    imageModelHq: readEnv('OPENROUTER_IMAGE_MODEL_HQ') || imageModel,
    imageOutputDir: readEnv('IMAGE_OUTPUT_DIR') || DEFAULT_CONFIG.imageOutputDir,
    apiTimeout: DEFAULT_CONFIG.apiTimeout,
    skipPromptEnhancement: readEnv('SKIP_PROMPT_ENHANCEMENT') === 'true',
    imageQuality: (readEnv('IMAGE_QUALITY') || 'fast') as ImageQuality,
    ...(appUrl !== undefined ? { appUrl } : {}),
    ...(appTitle !== undefined ? { appTitle } : {}),
  }

  return validateConfig(config)
}
