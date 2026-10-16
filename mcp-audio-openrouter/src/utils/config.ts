/**
 * Configuration management for the OpenRouter MCP audio server.
 * Handles environment variables and configuration validation.
 *
 * OpenRouter-only, single provider reached over an OpenAI-compatible
 * endpoint. Music (Lyria 3) and GPT Audio voice generation use OpenRouter's
 * `/chat/completions` endpoint with `modalities:["text","audio"]` and
 * `stream:true`; speech-only TTS models (ElevenLabs, ...) use `/audio/speech`.
 * See docs/OPENROUTER_API.md for the verified contract.
 */

import type { AudioFormat, MusicLength, Voice } from '../types/mcp.js'
import { AUDIO_FORMAT_VALUES } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import { ConfigError } from './errors.js'
import { describeVoiceIdProblem } from './voiceId.js'

/**
 * Which OpenRouter endpoint `generate_voice` uses.
 * - `auto`: look the model up in the speech catalog (speech-only -> `/audio/speech`, else chat).
 * - `chat`: force `/chat/completions` streaming (GPT Audio style).
 * - `speech`: force `/audio/speech` (speech-only TTS models such as ElevenLabs).
 */
export type VoiceEndpointMode = 'auto' | 'chat' | 'speech'

const VOICE_ENDPOINT_VALUES: readonly VoiceEndpointMode[] = ['auto', 'chat', 'speech'] as const

/**
 * Configuration interface
 */
export interface Config {
  /** OpenRouter API key (required). */
  openrouterApiKey: string
  /** Base URL for the OpenRouter OpenAI-compatible API. */
  baseUrl: string
  /** Voice-generation model (GPT Audio, or a speech-only TTS model such as ElevenLabs). */
  voiceModel: string
  /** Endpoint routing for voice generation (see `VoiceEndpointMode`). */
  voiceEndpoint: VoiceEndpointMode
  /** Music-generation model for the `clip` length preset. */
  musicModel: string
  /** Music-generation model for the `long` length preset (falls back to `musicModel` when unset). */
  musicModelLong: string
  /** Optional HTTP-Referer for OpenRouter attribution. */
  appUrl?: string
  /** Optional X-Title for OpenRouter attribution. */
  appTitle?: string
  /** Output directory for generated audio (absolute recommended for Claude Desktop). */
  audioOutputDir: string
  /** API timeout in milliseconds for the streaming audio request. */
  apiTimeout: number
  /** Default voice id when the caller doesn't specify one. */
  defaultVoice: Voice
  /** Default output audio format when the caller doesn't specify one. */
  defaultAudioFormat: AudioFormat
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG = {
  baseUrl: 'https://openrouter.ai/api/v1',
  voiceModel: 'openai/gpt-audio',
  voiceEndpoint: 'auto' as const,
  musicModel: 'google/lyria-3-clip-preview',
  audioOutputDir: './output',
  // Streaming audio generation can run considerably longer than a single
  // non-streaming API call (a Lyria 3 Pro track can take a couple of
  // minutes to stream) — this default is intentionally longer than the
  // 30s timeout that suffices for a single image-generation request.
  apiTimeout: 120000, // 120 seconds
  defaultVoice: 'alloy' as const,
  defaultAudioFormat: 'wav' as const,
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
  if (!config.voiceModel || config.voiceModel.trim().length === 0) {
    return Err(
      new ConfigError(
        'OPENROUTER_VOICE_MODEL cannot be empty',
        'Leave OPENROUTER_VOICE_MODEL unset to use the default, or set a valid model ID'
      )
    )
  }

  if (!config.musicModel || config.musicModel.trim().length === 0) {
    return Err(
      new ConfigError(
        'OPENROUTER_MUSIC_MODEL cannot be empty',
        'Leave OPENROUTER_MUSIC_MODEL unset to use the default, or set a valid model ID'
      )
    )
  }

  // Validate apiTimeout
  if (config.apiTimeout <= 0) {
    return Err(
      new ConfigError(
        'API timeout must be a positive number',
        'Set a positive timeout value in milliseconds (e.g., 120000 for 120 seconds)'
      )
    )
  }

  // Validate audioOutputDir (basic check - non-empty string)
  if (!config.audioOutputDir || config.audioOutputDir.trim().length === 0) {
    return Err(
      new ConfigError(
        'AUDIO_OUTPUT_DIR cannot be empty',
        'Set AUDIO_OUTPUT_DIR to a valid directory path'
      )
    )
  }

  // Validate voiceEndpoint
  if (!VOICE_ENDPOINT_VALUES.includes(config.voiceEndpoint)) {
    return Err(
      new ConfigError(
        `Invalid OPENROUTER_VOICE_ENDPOINT value: "${config.voiceEndpoint}". Valid options: ${VOICE_ENDPOINT_VALUES.join(', ')}`,
        `Set OPENROUTER_VOICE_ENDPOINT to one of: ${VOICE_ENDPOINT_VALUES.join(', ')}`
      )
    )
  }

  // Validate defaultVoice (shape only: ids are provider-specific)
  const voiceProblem = describeVoiceIdProblem(config.defaultVoice)
  if (voiceProblem) {
    return Err(
      new ConfigError(
        `Invalid OPENROUTER_VOICE_DEFAULT value: ${voiceProblem}`,
        'Set OPENROUTER_VOICE_DEFAULT to a voice id valid for your voice model (e.g. alloy, george), or leave it unset'
      )
    )
  }

  // Validate defaultAudioFormat
  if (!AUDIO_FORMAT_VALUES.includes(config.defaultAudioFormat)) {
    return Err(
      new ConfigError(
        `Invalid AUDIO_DEFAULT_FORMAT value: "${config.defaultAudioFormat}". Valid options: ${AUDIO_FORMAT_VALUES.join(', ')}`,
        `Set AUDIO_DEFAULT_FORMAT to one of: ${AUDIO_FORMAT_VALUES.join(', ')}`
      )
    )
  }

  return Ok(config)
}

/**
 * Loads configuration from environment variables.
 *
 * `OPENROUTER_MUSIC_MODEL_LONG` falls back to `OPENROUTER_MUSIC_MODEL` when unset.
 * @returns Result containing config or ConfigError
 */
export function getConfig(): Result<Config, ConfigError> {
  const musicModel = readEnv('OPENROUTER_MUSIC_MODEL') || DEFAULT_CONFIG.musicModel
  const appUrl = readEnv('OPENROUTER_APP_URL')
  const appTitle = readEnv('OPENROUTER_APP_TITLE')

  const config: Config = {
    openrouterApiKey: readEnv('OPENROUTER_API_KEY') || '',
    baseUrl: readEnv('OPENROUTER_BASE_URL') || DEFAULT_CONFIG.baseUrl,
    voiceModel: readEnv('OPENROUTER_VOICE_MODEL') || DEFAULT_CONFIG.voiceModel,
    voiceEndpoint: (readEnv('OPENROUTER_VOICE_ENDPOINT') ||
      DEFAULT_CONFIG.voiceEndpoint) as VoiceEndpointMode,
    musicModel,
    musicModelLong: readEnv('OPENROUTER_MUSIC_MODEL_LONG') || musicModel,
    audioOutputDir: readEnv('AUDIO_OUTPUT_DIR') || DEFAULT_CONFIG.audioOutputDir,
    apiTimeout: DEFAULT_CONFIG.apiTimeout,
    defaultVoice: readEnv('OPENROUTER_VOICE_DEFAULT') || DEFAULT_CONFIG.defaultVoice,
    defaultAudioFormat: (readEnv('AUDIO_DEFAULT_FORMAT') ||
      DEFAULT_CONFIG.defaultAudioFormat) as AudioFormat,
    ...(appUrl !== undefined ? { appUrl } : {}),
    ...(appTitle !== undefined ? { appTitle } : {}),
  }

  return validateConfig(config)
}

/**
 * Selects the music model slug for a given length preset.
 */
export function selectMusicModel(config: Config, length: MusicLength): string {
  return length === 'long' ? config.musicModelLong : config.musicModel
}
