import type { AudioFormat, MusicLength, Voice } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import type {
  AudioAPIError,
  InputValidationError,
  NetworkError,
  TimeoutError,
} from '../utils/errors.js'

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

/** Which OpenRouter endpoint produced a voice result. */
export type VoiceEndpointUsed = 'chat_completions' | 'speech'

export interface VoiceGenerationMetadata extends AudioGenerationMetadataBase {
  voice: Voice
  /** Incremental transcript assembled from the streamed response, so the
   * caller can verify what was actually spoken without playing the file.
   * Empty on the speech path (that endpoint returns no transcript). */
  transcript: string
  endpoint: VoiceEndpointUsed
  /** `X-Generation-Id` from the speech endpoint, for support tickets. */
  generationId?: string
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
 * generation: music and GPT Audio voice share OpenRouter's
 * `/chat/completions` + `modalities:["text","audio"]` streaming surface
 * (docs/SPEC.md D2); speech-only TTS models are routed to `/audio/speech`
 * (docs/SPEC.md D10) behind the same `generateVoice` call.
 */
export interface AudioClient {
  generateVoice(
    params: VoiceApiParams
  ): Promise<
    Result<GeneratedVoiceResult, AudioAPIError | NetworkError | TimeoutError | InputValidationError>
  >
  generateMusic(
    params: MusicApiParams
  ): Promise<Result<GeneratedMusicResult, AudioAPIError | NetworkError | TimeoutError>>
}
