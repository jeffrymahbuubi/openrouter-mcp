/**
 * Tests for the `/audio/speech` request + binary response handling (U3).
 * Contract: docs/OPENROUTER_API.md §6. Uses a mocked global `fetch`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../utils/config'
import { requestSpeech } from '../speechEndpoint'

const mockFetch = vi.fn()

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    openrouterApiKey: 'sk-or-test-key-12345',
    baseUrl: 'https://openrouter.ai/api/v1',
    voiceModel: 'elevenlabs/eleven-v3',
    voiceEndpoint: 'auto',
    musicModel: 'google/lyria-3-clip-preview',
    musicModelLong: 'google/lyria-3-pro-preview',
    audioOutputDir: './output',
    apiTimeout: 120000,
    defaultVoice: 'alloy',
    defaultAudioFormat: 'wav',
    ...overrides,
  }
}

/** ID3v2-prefixed bytes standing in for an MP3 body. */
const MP3_BYTES = Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.alloc(2000, 1)])

function binaryOk(body: Buffer, headers: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    arrayBuffer: async () =>
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    text: async () => body.toString('utf8'),
  }
}

function errorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => body,
  }
}

function requestBody() {
  const init = mockFetch.mock.calls[0]?.[1] as { body: string }
  return JSON.parse(init.body)
}

const MODEL = 'elevenlabs/eleven-v3'

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestSpeech — request shaping', () => {
  it('POSTs {model,input,voice,response_format:"mp3"} to {baseUrl}/audio/speech and returns mp3 bytes unchanged', async () => {
    mockFetch.mockResolvedValue(binaryOk(MP3_BYTES, { 'Content-Type': 'audio/mpeg' }))

    const result = await requestSpeech(
      makeConfig({ appUrl: 'https://app.example', appTitle: 'T' }),
      MODEL,
      {
        prompt: 'Hello there',
        voice: 'george',
        format: 'mp3',
      }
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mimeType).toBe('audio/mpeg')
      expect(result.data.audioData.equals(MP3_BYTES)).toBe(true)
    }
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/audio/speech')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-or-test-key-12345')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['HTTP-Referer']).toBe('https://app.example')
    expect(headers['X-Title']).toBe('T')
    expect(requestBody()).toEqual({
      model: MODEL,
      input: 'Hello there',
      voice: 'george',
      response_format: 'mp3',
    })
  })

  it('requests response_format "pcm" for format "wav" and wraps the PCM in a 24 kHz mono WAV', async () => {
    const pcm = Buffer.alloc(1000, 3)
    mockFetch.mockResolvedValue(binaryOk(pcm, { 'Content-Type': 'audio/pcm' }))

    const result = await requestSpeech(makeConfig(), MODEL, {
      prompt: 'hi',
      voice: 'george',
      format: 'wav',
    })

    expect(requestBody().response_format).toBe('pcm')
    expect(result.success).toBe(true)
    if (result.success) {
      const wav = result.data.audioData
      expect(wav.length).toBe(1044)
      expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
      expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
      expect(wav.readUInt16LE(22)).toBe(1) // channels
      expect(wav.readUInt32LE(24)).toBe(24000) // sample rate
      expect(wav.readUInt16LE(34)).toBe(16) // bits per sample
      expect(wav.subarray(44).equals(pcm)).toBe(true)
      expect(result.data.mimeType).toBe('audio/wav')
    }
  })

  it('treats PCM as PCM even when its first bytes look like an MPEG frame sync', async () => {
    // A 16-bit LE sample of -1 is 0xFF 0xFF, which the 2-byte MPEG sync check
    // would call mp3. Content-Type: audio/pcm must win over that weak signal.
    const pcm = Buffer.concat([Buffer.from([0xff, 0xff]), Buffer.alloc(998, 0)])
    mockFetch.mockResolvedValue(binaryOk(pcm, { 'Content-Type': 'audio/pcm' }))

    const result = await requestSpeech(makeConfig(), MODEL, {
      prompt: 'hi',
      voice: 'george',
      format: 'wav',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mimeType).toBe('audio/wav')
      expect(result.data.audioData.length).toBe(1044)
    }
  })

  it('passes through a RIFF/WAVE body unchanged', async () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.alloc(4),
      Buffer.from('WAVE', 'ascii'),
      Buffer.alloc(100),
    ])
    mockFetch.mockResolvedValue(binaryOk(wav, { 'Content-Type': 'audio/wav' }))

    const result = await requestSpeech(makeConfig(), MODEL, {
      prompt: 'hi',
      voice: 'george',
      format: 'wav',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mimeType).toBe('audio/wav')
      expect(result.data.audioData.equals(wav)).toBe(true)
    }
  })

  it('labels the file by the sniffed bytes when the provider returns mp3 although pcm was requested', async () => {
    mockFetch.mockResolvedValue(binaryOk(MP3_BYTES, { 'Content-Type': 'audio/mpeg' }))

    const result = await requestSpeech(makeConfig(), MODEL, {
      prompt: 'hi',
      voice: 'george',
      format: 'wav',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mimeType).toBe('audio/mpeg')
    }
  })

  it('returns X-Generation-Id', async () => {
    mockFetch.mockResolvedValue(
      binaryOk(MP3_BYTES, { 'Content-Type': 'audio/mpeg', 'X-Generation-Id': 'gen-123' })
    )

    const result = await requestSpeech(makeConfig(), MODEL, {
      prompt: 'hi',
      voice: 'george',
      format: 'mp3',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.generationId).toBe('gen-123')
    }
  })
})

describe('requestSpeech — unusable 200 responses', () => {
  it('errors when a 200 carries a JSON body instead of audio', async () => {
    mockFetch.mockResolvedValue(
      binaryOk(Buffer.from('{"error":{"message":"nope"}}'), { 'Content-Type': 'application/json' })
    )

    const result = await requestSpeech(makeConfig(), MODEL, {
      prompt: 'hi',
      voice: 'george',
      format: 'mp3',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('AUDIO_API_ERROR')
      expect(result.error.context?.['stage']).toBe('audio_extraction')
    }
  })

  it('errors when a 200 has a zero-length body', async () => {
    mockFetch.mockResolvedValue(binaryOk(Buffer.alloc(0), { 'Content-Type': 'audio/mpeg' }))

    const result = await requestSpeech(makeConfig(), MODEL, {
      prompt: 'hi',
      voice: 'george',
      format: 'mp3',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('AUDIO_API_ERROR')
      expect(result.error.context?.['stage']).toBe('audio_extraction')
    }
  })
})

describe('requestSpeech — error mapping', () => {
  async function failWith(status: number, body: string) {
    mockFetch.mockResolvedValue(errorResponse(status, body))
    const result = await requestSpeech(makeConfig(), MODEL, {
      prompt: 'hi',
      voice: 'george',
      format: 'mp3',
    })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected failure')
    return result.error
  }

  it('maps 402 to AUDIO_API_ERROR with statusCode and a credits suggestion (AE5)', async () => {
    const error = await failWith(402, '{"error":{"code":402,"message":"Insufficient credits"}}')

    expect(error.code).toBe('AUDIO_API_ERROR')
    expect((error as { statusCode?: number }).statusCode).toBe(402)
    expect(error.context?.['upstreamMessage']).toBe('Insufficient credits')
    expect(error.context?.['stage']).toBe('speech_generation')
    expect(error.suggestion.toLowerCase()).toContain('credits')
  })

  it('suggests checking supported voices for a 400 that mentions voice', async () => {
    const error = await failWith(400, '{"error":{"message":"voice \'alloy\' is not available"}}')

    expect((error as { statusCode?: number }).statusCode).toBe(400)
    expect(error.suggestion.toLowerCase()).toContain('supported voices')
  })

  it('names the model in the suggestion for a 404', async () => {
    const error = await failWith(404, '{"error":{"message":"No such endpoint"}}')

    expect(error.suggestion).toContain(MODEL)
  })

  it('maps 401 to an API-key suggestion', async () => {
    const error = await failWith(401, '{"error":{"message":"No auth credentials found"}}')

    expect(error.suggestion).toContain('OPENROUTER_API_KEY')
  })

  it('maps 429 to a rate-limit suggestion', async () => {
    const error = await failWith(429, '{"error":{"message":"Too many requests"}}')

    expect(error.suggestion.toLowerCase()).toContain('rate limit')
  })

  it('maps 502 to a provider-unavailable suggestion', async () => {
    const error = await failWith(502, '{"error":{"message":"Provider returned error"}}')

    expect(error.suggestion.toLowerCase()).toContain('provider')
    expect(error.suggestion.toLowerCase()).toContain('unavailable')
  })

  it('maps a TimeoutError from fetch to NETWORK_ERROR', async () => {
    const timeout = new Error('The operation was aborted due to timeout')
    timeout.name = 'TimeoutError'
    mockFetch.mockRejectedValue(timeout)

    const result = await requestSpeech(makeConfig(), MODEL, {
      prompt: 'hi',
      voice: 'george',
      format: 'mp3',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('NETWORK_ERROR')
    }
  })
})
