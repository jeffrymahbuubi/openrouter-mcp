import type { AudioFormat, MusicLength, Voice } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import type { AudioAPIError, NetworkError } from '../utils/errors.js'

/**
 * Provider-neutral metadata for generated audio.
 */
interface AudioGenerationMetadataBase {
  model: string
  prompt: string
  mimeType: string
  timestamp: Date
  provider?: string
}

export interface VoiceGenerationMetadata extends AudioGenerationMetadataBase {
  voice: Voice
  /** Incremental transcript assembled from the streamed response, so the
   * caller can verify what was actually spoken without playing the file. */
  transcript: string
}

export interface MusicGenerationMetadata extends AudioGenerationMetadataBase {
  length: MusicLength
}

/**
 * Provider-neutral voice-generation parameters.
 */
export interface VoiceApiParams {
  prompt: string
  voice: Voice
  format: AudioFormat
}

/**
 * Provider-neutral music-generation parameters.
 */
export interface MusicApiParams {
  prompt: string
  length: MusicLength
  format: AudioFormat
}

/**
 * Result of voice generation.
 */
export interface GeneratedVoiceResult {
  audioData: Buffer
  metadata: VoiceGenerationMetadata
}

/**
 * Result of music generation.
 */
export interface GeneratedMusicResult {
  audioData: Buffer
  metadata: MusicGenerationMetadata
}

/**
 * Provider-neutral audio client. One client serves both voice and music
 * generation because both are reached through OpenRouter's identical
 * `/chat/completions` + `modalities:["text","audio"]` streaming surface —
 * see docs/SPEC.md D2 and docs/OPENROUTER_API.md.
 */
export interface AudioClient {
  generateVoice(
    params: VoiceApiParams
  ): Promise<Result<GeneratedVoiceResult, AudioAPIError | NetworkError>>
  generateMusic(
    params: MusicApiParams
  ): Promise<Result<GeneratedMusicResult, AudioAPIError | NetworkError>>
}
