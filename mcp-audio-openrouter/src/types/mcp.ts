/**
 * MCP-related type definitions
 * Defines types related to @modelcontextprotocol/sdk and project-specific types
 */

/**
 * Voice identifier. Provider-specific: GPT Audio uses the presets in
 * `GPT_AUDIO_VOICES`; speech-only TTS models (ElevenLabs, ...) use their own
 * ids (e.g. `george`). Shape is validated in `utils/voiceId.ts`; membership
 * is checked against the model's catalog `supported_voices`.
 */
export type Voice = string

/**
 * Voice presets supported by OpenAI's GPT Audio (`openai/gpt-audio` on
 * OpenRouter). Documentation/description constant only, not a validation
 * list. See docs/OPENROUTER_API.md §2.
 */
export const GPT_AUDIO_VOICES: readonly string[] = [
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
] as const

/**
 * Output audio container/codec. `wav` is the default (matches OpenRouter's
 * documented example body and is simplest to verify byte-for-byte).
 */
export type AudioFormat = 'wav' | 'mp3'

export const AUDIO_FORMAT_VALUES: readonly AudioFormat[] = ['wav', 'mp3'] as const

/**
 * Track-length preset for music generation.
 * - 'clip': ~30 second clip via Lyria 3 Clip (fast, cheap; default)
 * - 'long': up to a couple of minutes via Lyria 3 Pro
 */
export type MusicLength = 'clip' | 'long'

export const MUSIC_LENGTH_VALUES: readonly MusicLength[] = ['clip', 'long'] as const

/**
 * Parameters for the `generate_voice` tool (spoken dialogue/narration via GPT Audio).
 */
export interface GenerateVoiceParams {
  /** The text to speak, optionally with delivery/emotion/pacing instructions. */
  prompt: string
  /** Custom file name for the output audio. Auto-generated if not specified. */
  fileName?: string
  /** Voice id for speech synthesis (default: server-configured default). */
  voice?: Voice
  /** Output audio container/codec (default: "wav"). */
  format?: AudioFormat
}

/**
 * Parameters for the `generate_music` tool (instrumental background music via Lyria 3).
 */
export interface GenerateMusicParams {
  /** Description of the desired music: genre, mood, instrumentation, tempo, structure. */
  prompt: string
  /** Custom file name for the output audio. Auto-generated if not specified. */
  fileName?: string
  /** Track length preset (default: "clip"). */
  length?: MusicLength
  /** Output audio container/codec (default: "wav"). */
  format?: AudioFormat
}

/**
 * MCP server configuration
 */
export interface MCPServerConfig {
  /** Server name */
  name: string
  /** Version */
  version: string
  /** Default audio output directory */
  defaultOutputDir: string
}

/**
 * Content types for MCP responses. Audio is never returned inline (see
 * docs/SPEC.md D3) — only `text` content blocks are used.
 */
type McpContent = {
  type: 'text'
  text: string
}

/**
 * MCP Tool Response format
 */
export interface McpToolResponse {
  content: McpContent[]
  isError?: boolean
  structuredContent?: unknown
}

/**
 * Structured content for successful voice-generation responses.
 */
export interface VoiceStructuredContent {
  type: 'resource'
  resource: {
    uri: string
    name: string
    mimeType: string
  }
  metadata: {
    model: string
    provider: 'openrouter'
    voice: string
    format: AudioFormat
    /** Which OpenRouter endpoint produced the audio. */
    endpoint: 'chat_completions' | 'speech'
    /** `X-Generation-Id` from the speech endpoint, when present. */
    generationId?: string
    /** Omitted on the speech path (that endpoint returns no transcript). */
    transcript?: string
    processingTime: number
    timestamp: string
  }
}

/**
 * Structured content for successful music-generation responses.
 */
export interface MusicStructuredContent {
  type: 'resource'
  resource: {
    uri: string
    name: string
    mimeType: string
  }
  metadata: {
    model: string
    provider: 'openrouter'
    length: MusicLength
    format: AudioFormat
    prompt: string
    processingTime: number
    timestamp: string
  }
}
