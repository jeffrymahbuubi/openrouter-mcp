/**
 * OpenRouter text-to-speech endpoint (`POST {baseUrl}/audio/speech`).
 *
 * Speech-only TTS models (ElevenLabs, ...) are served here, not by
 * `/chat/completions`. The request is plain JSON; the success response is raw
 * audio bytes (not SSE, not base64). `response_format` accepts `mp3` or `pcm`
 * only: `pcm` is headerless 16-bit little-endian PCM, which this module wraps
 * in a WAV container so the saved file is playable. See docs/SPEC.md D12 and
 * docs/OPENROUTER_API.md §6.
 */

import type { AudioFormat } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import { sniffAudioFormat } from '../utils/audioFormatSniffer.js'
import type { Config } from '../utils/config.js'
import { AudioAPIError, type NetworkError, type TimeoutError } from '../utils/errors.js'
import { Logger } from '../utils/logger.js'
import { mimeTypeForFormat } from '../utils/mimeUtils.js'
import { pcm16ToWav } from '../utils/pcmToWav.js'
import { buildHttpError, classifyThrownError } from './errorClassification.js'

/**
 * Sample rate and channel count assumed for `/audio/speech` PCM output.
 * OpenRouter documents PCM as 16-bit little-endian but only states a rate for
 * some providers; 24 kHz mono matches the OpenAI convention used elsewhere in
 * this project. Verified for ElevenLabs by the live smoke test (see
 * docs/OPENROUTER_API.md §6). Kept separate from the GPT Audio constant so a
 * correction is a one-line change here.
 */
const SPEECH_PCM_SAMPLE_RATE = 24000
const SPEECH_PCM_CHANNELS = 1

type SpeechResponseFormat = 'mp3' | 'pcm'

interface SpeechRequest {
  model: string
  input: string
  voice: string
  response_format: SpeechResponseFormat
}

export interface SpeechParams {
  prompt: string
  voice: string
  format: AudioFormat
}

export interface SpeechResult {
  audioData: Buffer
  mimeType: string
  /** From the `X-Generation-Id` response header, when present. */
  generationId?: string
}

type SpeechKind = 'wav' | 'mp3' | 'pcm'

const logger = new Logger()

/** `wav` is produced locally from PCM; the endpoint has no `wav` format. */
function wireFormatFor(format: AudioFormat): SpeechResponseFormat {
  return format === 'mp3' ? 'mp3' : 'pcm'
}

/**
 * Decides what the returned bytes really are. Sniffing comes first (R4), with
 * one exception: raw PCM can legitimately begin with 0xFF 0xE0+ (a tiny
 * negative first sample), which the two-byte MPEG sync check would call mp3.
 * So when the response declares `audio/pcm`, only a strong magic number (ID3 or
 * RIFF/WAVE) overrides it.
 */
function resolveKind(bytes: Buffer, contentType: string, requested: AudioFormat): SpeechKind {
  const sniffed = sniffAudioFormat(bytes)
  const hasId3 = bytes.length >= 3 && bytes.subarray(0, 3).toString('ascii') === 'ID3'
  const declaredPcm = contentType.includes('audio/pcm') || contentType.includes('audio/l16')

  if (sniffed === 'wav') return 'wav'
  if (hasId3) return 'mp3'
  if (declaredPcm) return 'pcm'
  if (sniffed === 'mp3') return 'mp3'
  if (contentType.includes('audio/mpeg')) return 'mp3'
  // Nothing identifies the bytes: fall back to what was requested.
  return requested === 'wav' ? 'pcm' : 'mp3'
}

/**
 * Performs one `/audio/speech` call and returns the playable audio bytes plus
 * the mime type of what was actually returned.
 */
export async function requestSpeech(
  config: Config,
  model: string,
  params: SpeechParams
): Promise<Result<SpeechResult, AudioAPIError | NetworkError | TimeoutError>> {
  const body: SpeechRequest = {
    model,
    input: params.prompt,
    voice: params.voice,
    response_format: wireFormatFor(params.format),
  }

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openrouterApiKey}`,
        'Content-Type': 'application/json',
        ...(config.appUrl && { 'HTTP-Referer': config.appUrl }),
        ...(config.appTitle && { 'X-Title': config.appTitle }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.apiTimeout),
    })
  } catch (error) {
    return Err(classifyThrownError(error, config.apiTimeout))
  }

  if (!response.ok) {
    return Err(await buildHttpError(response, { model, stage: 'speech_generation' }))
  }

  let bytes: Buffer
  try {
    bytes = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    return Err(classifyThrownError(error, config.apiTimeout))
  }

  const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
  if (bytes.length === 0 || contentType.includes('application/json')) {
    return Err(
      new AudioAPIError(
        bytes.length === 0
          ? 'OpenRouter returned an empty audio body from /audio/speech'
          : 'OpenRouter returned JSON instead of audio from /audio/speech',
        {
          provider: 'openrouter',
          model,
          stage: 'audio_extraction',
          suggestion: 'Retry the request or verify that the selected model supports speech output',
        }
      )
    )
  }

  const kind = resolveKind(bytes, contentType, params.format)
  const expected: SpeechKind = params.format === 'mp3' ? 'mp3' : 'pcm'
  if (kind !== expected && !(kind === 'wav' && expected === 'pcm')) {
    logger.warn(
      'speechEndpoint',
      'OpenRouter returned a different audio format than requested for generate_voice',
      { model, requestedFormat: wireFormatFor(params.format), actualFormat: kind }
    )
  }

  const generationId = response.headers.get('x-generation-id') ?? undefined
  const extra = generationId ? { generationId } : {}

  if (kind === 'pcm') {
    return Ok({
      audioData: pcm16ToWav(bytes, SPEECH_PCM_SAMPLE_RATE, SPEECH_PCM_CHANNELS),
      mimeType: mimeTypeForFormat('wav'),
      ...extra,
    })
  }
  return Ok({ audioData: bytes, mimeType: mimeTypeForFormat(kind), ...extra })
}
