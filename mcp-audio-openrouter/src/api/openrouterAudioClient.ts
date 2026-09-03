/**
 * OpenRouter audio client for both voice (GPT Audio) and music (Lyria 3)
 * generation.
 *
 * Both models are reached via a raw `fetch` POST to `{baseUrl}/chat/completions`
 * with `modalities:["text","audio"]` and `stream:true` — OpenRouter's audio
 * output requires streaming; the response arrives as SSE chunks whose
 * `choices[0].delta.audio.data` fields carry base64 audio fragments (see
 * docs/OPENROUTER_API.md). Raw `fetch` is used instead of the `openai` SDK
 * because the SDK does not expose a typed accumulator for multi-chunk
 * base64 + transcript reassembly — the same "bypass the SDK when the
 * contract diverges" rationale the sibling image project used for its
 * dedicated Images API.
 */

import type { AudioFormat } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import { sniffAudioFormat } from '../utils/audioFormatSniffer.js'
import type { Config } from '../utils/config.js'
import { selectMusicModel } from '../utils/config.js'
import { AudioAPIError, NetworkError } from '../utils/errors.js'
import { Logger } from '../utils/logger.js'
import { mimeTypeForFormat } from '../utils/mimeUtils.js'
import { pcm16ToWav } from '../utils/pcmToWav.js'
import type {
  AudioClient,
  GeneratedMusicResult,
  GeneratedVoiceResult,
  MusicApiParams,
  VoiceApiParams,
} from './audioClient.js'
import { isNetworkError } from './errorClassification.js'

/**
 * The wire-level `audio.format` accepted by OpenRouter's streaming
 * chat-completions audio endpoint. This is NOT the same set as the
 * tool-facing `AudioFormat` ('wav' | 'mp3') — verified live (2026-09-03):
 * `openai/gpt-audio` rejects `wav`/`mp3` with HTTP 400
 * ("does not support 'wav' when stream=true. Supported values are:
 * 'pcm16'.") and only accepts `"pcm16"` when `stream:true`. See
 * docs/OPENROUTER_API.md §2/§3.
 */
type WireAudioFormat = 'pcm16' | AudioFormat

interface ChatCompletionsAudioRequest {
  model: string
  messages: Array<{ role: 'user'; content: string }>
  modalities: ['text', 'audio']
  audio: { voice?: string; format: WireAudioFormat }
  stream: true
}

interface SseAudioDelta {
  audio?: { data?: string; transcript?: string }
}

interface SseChatCompletionChunk {
  choices?: Array<{ delta?: SseAudioDelta }>
}

interface StreamedAudio {
  audioBase64: string
  transcript: string
}

class OpenRouterAudioClientImpl implements AudioClient {
  private readonly logger = new Logger()

  constructor(private readonly config: Config) {}

  async generateVoice(
    params: VoiceApiParams
  ): Promise<Result<GeneratedVoiceResult, AudioAPIError | NetworkError>> {
    const model = this.config.voiceModel
    // Only "pcm16" is accepted for streaming audio output on this endpoint
    // (verified live — see WireAudioFormat doc comment above); params.format
    // ('wav'/'mp3') describes the *tool's* output container, not the wire
    // format, and is honored by wrapping the raw PCM ourselves below.
    const request: ChatCompletionsAudioRequest = {
      model,
      messages: [{ role: 'user', content: params.prompt }],
      modalities: ['text', 'audio'],
      audio: { voice: params.voice, format: 'pcm16' },
      stream: true,
    }

    const streamResult = await this.streamAudioCompletion(model, request)
    if (!streamResult.success) {
      return Err(streamResult.error)
    }

    // The stream returns raw, headerless 16-bit PCM — wrap it in a WAV
    // container so the saved file is actually playable. mp3 is not
    // achievable via this streaming mechanism today, so the output is
    // always a WAV file regardless of the requested `format` (see
    // docs/OPENROUTER_API.md §2).
    const rawPcm = Buffer.from(streamResult.data.audioBase64, 'base64')
    const audioData = pcm16ToWav(rawPcm)

    return Ok({
      audioData,
      metadata: {
        model,
        provider: 'openrouter',
        prompt: params.prompt,
        mimeType: mimeTypeForFormat('wav'),
        timestamp: new Date(),
        voice: params.voice,
        transcript: streamResult.data.transcript,
      },
    })
  }

  async generateMusic(
    params: MusicApiParams
  ): Promise<Result<GeneratedMusicResult, AudioAPIError | NetworkError>> {
    const model = selectMusicModel(this.config, params.length)
    const request: ChatCompletionsAudioRequest = {
      model,
      messages: [{ role: 'user', content: params.prompt }],
      modalities: ['text', 'audio'],
      // Lyria 3 has no voice concept (supported_voices: null) — omit `voice`.
      audio: { format: params.format },
      stream: true,
    }

    const streamResult = await this.streamAudioCompletion(model, request)
    if (!streamResult.success) {
      return Err(streamResult.error)
    }

    // Providers don't reliably honor the requested `audio.format` here —
    // verified live: requesting "wav" for Lyria 3 returns HTTP 200 with
    // actual MP3 bytes (ID3v2-tagged). Sniff the real bytes rather than
    // trusting the request, so the file is never mislabeled. See
    // docs/OPENROUTER_API.md §2.
    const audioData = Buffer.from(streamResult.data.audioBase64, 'base64')
    const sniffed = sniffAudioFormat(audioData)
    if (sniffed === 'unknown') {
      this.logger.warn(
        'openrouterAudioClient',
        'Could not detect the actual audio format returned for generate_music; ' +
          'falling back to the requested format for the mime type',
        { model, requestedFormat: params.format }
      )
    } else if (sniffed !== params.format) {
      this.logger.warn(
        'openrouterAudioClient',
        'OpenRouter returned a different audio format than requested for generate_music',
        { model, requestedFormat: params.format, actualFormat: sniffed }
      )
    }
    const mimeType = mimeTypeForFormat(sniffed === 'unknown' ? params.format : sniffed)

    return Ok({
      audioData,
      metadata: {
        model,
        provider: 'openrouter',
        prompt: params.prompt,
        mimeType,
        timestamp: new Date(),
        length: params.length,
      },
    })
  }

  /**
   * Streams a `/chat/completions` audio-modality request and reassembles
   * the base64 audio fragments + incremental transcript from the SSE chunks.
   * Individual deltas are base64 *fragments*, not independently valid
   * base64 strings — only the fully-joined string is decodable, so
   * `Buffer.from(..., 'base64')` must happen once, by the caller, after
   * this returns.
   */
  private async streamAudioCompletion(
    model: string,
    body: ChatCompletionsAudioRequest
  ): Promise<Result<StreamedAudio, AudioAPIError | NetworkError>> {
    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.openrouterApiKey}`,
          'Content-Type': 'application/json',
          ...(this.config.appUrl && { 'HTTP-Referer': this.config.appUrl }),
          ...(this.config.appTitle && { 'X-Title': this.config.appTitle }),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.apiTimeout),
      })
    } catch (error) {
      return this.handleThrownError(error)
    }

    if (!response.ok) {
      return Err(await this.buildHttpError(response, model))
    }

    if (!response.body) {
      return Err(
        new AudioAPIError('OpenRouter returned no response body for a streaming request', {
          provider: 'openrouter',
          model,
          stage: 'response_stream',
          suggestion: 'Retry the request; the provider returned an unexpected empty stream',
        })
      )
    }

    return this.consumeSseStream(response.body, model)
  }

  private async consumeSseStream(
    body: ReadableStream<Uint8Array>,
    model: string
  ): Promise<Result<StreamedAudio, AudioAPIError | NetworkError>> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const audioChunks: string[] = []
    let transcript = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? '' // keep incomplete trailing line for next read

        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') continue

          let event: SseChatCompletionChunk
          try {
            event = JSON.parse(payload) as SseChatCompletionChunk
          } catch {
            continue // ignore malformed keep-alive/comment lines
          }

          const delta = event.choices?.[0]?.delta
          if (delta?.audio?.data) audioChunks.push(delta.audio.data)
          if (delta?.audio?.transcript) transcript += delta.audio.transcript
        }
      }
    } catch (error) {
      return this.handleThrownError(error)
    }

    if (audioChunks.length === 0) {
      return Err(
        new AudioAPIError('No audio data returned from OpenRouter streaming response', {
          provider: 'openrouter',
          model,
          stage: 'audio_extraction',
          suggestion: 'Retry the request or verify that the selected model supports audio output',
        })
      )
    }

    return Ok({ audioBase64: audioChunks.join(''), transcript })
  }

  private async buildHttpError(response: Response, model: string): Promise<AudioAPIError> {
    let upstreamMessage = `HTTP ${response.status}`
    try {
      const text = await response.text()
      if (text) {
        upstreamMessage = text
      }
    } catch {
      // ignore body read failures; status is enough
    }

    return new AudioAPIError(
      `OpenRouter audio API request failed (HTTP ${response.status})`,
      {
        provider: 'openrouter',
        model,
        stage: 'audio_generation',
        upstreamMessage,
        suggestion: this.getAPIErrorSuggestion(`${response.status} ${upstreamMessage}`, model),
      },
      response.status
    )
  }

  private handleThrownError(error: unknown): Result<never, AudioAPIError | NetworkError> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const name = error instanceof Error ? error.name : ''

    // `fetch` throws TypeError on transport failure and TimeoutError/AbortError
    // on an aborted request — all network-class failures.
    if (
      isNetworkError(error) ||
      error instanceof TypeError ||
      name === 'TimeoutError' ||
      name === 'AbortError'
    ) {
      return Err(
        new NetworkError(
          'Network error during OpenRouter audio generation',
          'Check your internet connection and try again',
          error instanceof Error ? error : undefined
        )
      )
    }

    return Err(
      new AudioAPIError('Failed to generate audio with OpenRouter', {
        provider: 'openrouter',
        upstreamMessage: errorMessage,
        suggestion: 'Check OpenRouter API configuration and try again',
      })
    )
  }

  private getAPIErrorSuggestion(errorMessage: string, model: string): string {
    const lowerMessage = errorMessage.toLowerCase()

    if (lowerMessage.includes('quota') || lowerMessage.includes('rate limit')) {
      return 'You have exceeded your OpenRouter quota or rate limit. Wait before retrying or add credits'
    }
    if (lowerMessage.includes('401') || lowerMessage.includes('unauthorized')) {
      return 'Check that your OPENROUTER_API_KEY is valid and has audio generation access'
    }
    if (
      lowerMessage.includes('404') ||
      lowerMessage.includes('model') ||
      lowerMessage.includes('not found')
    ) {
      return `Ensure the audio model "${model}" exists and is available on OpenRouter`
    }
    return 'Check OpenRouter API configuration and try again'
  }
}

/**
 * Creates a new OpenRouter audio client.
 */
export function createOpenRouterAudioClient(config: Config): Result<AudioClient, AudioAPIError> {
  try {
    return Ok(new OpenRouterAudioClientImpl(config))
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return Err(
      new AudioAPIError(
        `Failed to initialize OpenRouter audio client: ${errorMessage}`,
        'Verify your OPENROUTER_API_KEY and OpenRouter model configuration'
      )
    )
  }
}
