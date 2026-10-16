/**
 * Input validation module for MCP server
 * Validates user inputs for the generate_voice and generate_music tools
 */

import type { GenerateMusicParams, GenerateVoiceParams } from '../types/mcp.js'
import { AUDIO_FORMAT_VALUES, MUSIC_LENGTH_VALUES } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import { InputValidationError } from '../utils/errors.js'
import { describeVoiceIdProblem } from '../utils/voiceId.js'

// Constants for validation limits
const PROMPT_MIN_LENGTH = 1
const PROMPT_MAX_LENGTH = 4000

/**
 * Validates prompt text for length constraints
 */
export function validatePrompt(prompt: string): Result<string, InputValidationError> {
  if (prompt.length < PROMPT_MIN_LENGTH || prompt.length > PROMPT_MAX_LENGTH) {
    return Err(
      new InputValidationError(
        `Prompt must be between ${PROMPT_MIN_LENGTH} and ${PROMPT_MAX_LENGTH} characters. Current length: ${prompt.length}`,
        prompt.length === 0
          ? 'Please provide a descriptive prompt for audio generation.'
          : `Please shorten your prompt by ${prompt.length - PROMPT_MAX_LENGTH} characters.`
      )
    )
  }

  return Ok(prompt)
}

/**
 * Validates complete GenerateVoiceParams object
 */
export function validateGenerateVoiceParams(
  params: GenerateVoiceParams
): Result<GenerateVoiceParams, InputValidationError> {
  const promptResult = validatePrompt(params.prompt)
  if (!promptResult.success) {
    return Err(promptResult.error)
  }

  if (params.voice !== undefined) {
    const problem = describeVoiceIdProblem(params.voice)
    if (problem) {
      return Err(
        new InputValidationError(
          `Invalid voice: ${problem}`,
          'Provide a voice id valid for the configured model (e.g. "alloy" for openai/gpt-audio, "george" for ElevenLabs), or omit voice to use the configured default.'
        )
      )
    }
  }

  if (params.format !== undefined && !AUDIO_FORMAT_VALUES.includes(params.format)) {
    return Err(
      new InputValidationError(
        `Invalid format: "${params.format}". Supported values: ${AUDIO_FORMAT_VALUES.join(', ')}`,
        `Please use one of the supported formats: ${AUDIO_FORMAT_VALUES.join(', ')}`
      )
    )
  }

  return Ok(params)
}

/**
 * Validates complete GenerateMusicParams object
 */
export function validateGenerateMusicParams(
  params: GenerateMusicParams
): Result<GenerateMusicParams, InputValidationError> {
  const promptResult = validatePrompt(params.prompt)
  if (!promptResult.success) {
    return Err(promptResult.error)
  }

  if (params.length !== undefined && !MUSIC_LENGTH_VALUES.includes(params.length)) {
    return Err(
      new InputValidationError(
        `Invalid length: "${params.length}". Supported values: ${MUSIC_LENGTH_VALUES.join(', ')}`,
        `Please use one of the supported length presets: ${MUSIC_LENGTH_VALUES.join(', ')}`
      )
    )
  }

  if (params.format !== undefined && !AUDIO_FORMAT_VALUES.includes(params.format)) {
    return Err(
      new InputValidationError(
        `Invalid format: "${params.format}". Supported values: ${AUDIO_FORMAT_VALUES.join(', ')}`,
        `Please use one of the supported formats: ${AUDIO_FORMAT_VALUES.join(', ')}`
      )
    )
  }

  return Ok(params)
}
