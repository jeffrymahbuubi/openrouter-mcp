/**
 * Tests for the OpenRouter audio client (voice + music generation).
 * Uses a mocked global `fetch` returning a fake SSE `ReadableStream`.
 * Contract: docs/OPENROUTER_API.md.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../utils/config'
import { createOpenRouterAudioClient } from '../openrouterAudioClient'

const mockFetch = vi.fn()

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    openrouterApiKey: 'sk-or-test-key-12345',
    baseUrl: 'https://openrouter.ai/api/v1',
    voiceModel: 'openai/gpt-audio',
    musicModel: 'google/lyria-3-clip-preview',
    musicModelLong: 'google/lyria-3-pro-preview',
    audioOutputDir: './output',
    apiTimeout: 120000,
    defaultVoice: 'alloy',
    defaultAudioFormat: 'wav',
    ...overrides,
  }
}

function unwrapClient(config: Config = makeConfig()) {
  const result = createOpenRouterAudioClient(config)
  if (!result.success) {
    throw new Error(`expected client, got error: ${result.error.message}`)
  }
  return result.data
}

/** Build a fake SSE `data:` line for a chat-completions audio-delta chunk. */
function sseLine(delta: { audio?: { data?: string; transcript?: string } }): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`
}

/** Build a fake ReadableStream<Uint8Array> emitting the given SSE lines then closing. */
function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < lines.length) {
        controller.enqueue(encoder.encode(lines[i]))
        i++
      } else {
        controller.close()
      }
    },
  })
}

function streamingOk(lines: string[]) {
  return {
    ok: true,
    status: 200,
    body: sseStream(lines),
    text: async () => '',
  }
}

function requestBody(callIndex = 0) {
  const init = mockFetch.mock.calls[callIndex]?.[1] as { body: string }
  return JSON.parse(init.body)
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('generateVoice — success & request shaping', () => {
  it('POSTs to {baseUrl}/chat/completions with modalities:["text","audio"] and stream:true', async () => {
    const b64 = Buffer.from('hello-audio').toString('base64')
    const half = Math.ceil(b64.length / 2)
    mockFetch.mockResolvedValue(
      streamingOk([
        sseLine({ audio: { data: b64.slice(0, half), transcript: 'Hello ' } }),
        sseLine({ audio: { data: b64.slice(half), transcript: 'world' } }),
        'data: [DONE]\n\n',
      ])
    )
    const client = unwrapClient()

    const result = await client.generateVoice({
      prompt: 'Say hello',
      voice: 'alloy',
      format: 'wav',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      // The stream returns raw PCM; the client wraps it in a 44-byte WAV
      // header (see src/utils/pcmToWav.ts), so the original bytes land
      // right after the header rather than at the start of the buffer.
      expect(result.data.audioData.subarray(0, 4).toString('ascii')).toBe('RIFF')
      expect(result.data.audioData.subarray(8, 12).toString('ascii')).toBe('WAVE')
      expect(result.data.audioData.subarray(44).toString('utf8')).toBe('hello-audio')
      expect(result.data.metadata.model).toBe('openai/gpt-audio')
      expect(result.data.metadata.mimeType).toBe('audio/wav')
      expect(result.data.metadata.voice).toBe('alloy')
      expect(result.data.metadata.transcript).toBe('Hello world')
    }

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-or-test-key-12345'
    )
    const body = requestBody()
    expect(body.model).toBe('openai/gpt-audio')
    expect(body.modalities).toEqual(['text', 'audio'])
    expect(body.stream).toBe(true)
    expect(body.audio.voice).toBe('alloy')
    // Verified live: OpenRouter's streaming voice endpoint rejects
    // wav/mp3 ("Supported values are: 'pcm16'") — the wire request always
    // asks for pcm16 regardless of the tool-facing `format` param.
    expect(body.audio.format).toBe('pcm16')
    expect(body.messages).toEqual([{ role: 'user', content: 'Say hello' }])
  })

  it('sends attribution headers when configured', async () => {
    mockFetch.mockResolvedValue(streamingOk([sseLine({ audio: { data: 'QUJD' } })]))
    const client = unwrapClient(makeConfig({ appUrl: 'https://app.example', appTitle: 'My App' }))

    await client.generateVoice({ prompt: 'hi', voice: 'nova', format: 'mp3' })

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['HTTP-Referer']).toBe('https://app.example')
    expect(headers['X-Title']).toBe('My App')
  })

  it('always returns audio/wav, even when mp3 is requested (pcm16-only streaming constraint)', async () => {
    mockFetch.mockResolvedValue(streamingOk([sseLine({ audio: { data: 'QUJD' } })]))
    const client = unwrapClient()

    const result = await client.generateVoice({ prompt: 'hi', voice: 'echo', format: 'mp3' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.metadata.mimeType).toBe('audio/wav')
    }
  })
})

describe('generateMusic — success & request shaping', () => {
  it('omits `voice` from the request and selects the clip model by default', async () => {
    mockFetch.mockResolvedValue(streamingOk([sseLine({ audio: { data: 'QUJD' } })]))
    const client = unwrapClient()

    const result = await client.generateMusic({
      prompt: 'lofi chiptune, C major',
      length: 'clip',
      format: 'wav',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.metadata.model).toBe('google/lyria-3-clip-preview')
      expect(result.data.metadata.length).toBe('clip')
    }
    const body = requestBody()
    expect(body.model).toBe('google/lyria-3-clip-preview')
    expect(body.audio.voice).toBeUndefined()
  })

  it('selects OPENROUTER_MUSIC_MODEL_LONG when length is "long"', async () => {
    mockFetch.mockResolvedValue(streamingOk([sseLine({ audio: { data: 'QUJD' } })]))
    const client = unwrapClient()

    await client.generateMusic({ prompt: 'epic orchestral', length: 'long', format: 'wav' })

    expect(requestBody().model).toBe('google/lyria-3-pro-preview')
  })

  it('falls back to the clip model when musicModelLong equals musicModel (unset override)', async () => {
    mockFetch.mockResolvedValue(streamingOk([sseLine({ audio: { data: 'QUJD' } })]))
    const client = unwrapClient(makeConfig({ musicModelLong: 'google/lyria-3-clip-preview' }))

    await client.generateMusic({ prompt: 'ambient pad', length: 'long', format: 'wav' })

    expect(requestBody().model).toBe('google/lyria-3-clip-preview')
  })

  it('reports the sniffed mime type when the provider returns a different format than requested', async () => {
    // Verified live: Lyria 3 returns actual MP3 (ID3v2-tagged) bytes even
    // when "wav" is requested. The client must not trust the request.
    const mp3Bytes = Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.alloc(20)])
    const b64 = mp3Bytes.toString('base64')
    mockFetch.mockResolvedValue(streamingOk([sseLine({ audio: { data: b64 } })]))
    const client = unwrapClient()

    const result = await client.generateMusic({
      prompt: 'lofi chiptune, C major',
      length: 'clip',
      format: 'wav',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.metadata.mimeType).toBe('audio/mpeg')
    }
  })

  it('falls back to the requested format mime type when the returned bytes are unrecognized', async () => {
    mockFetch.mockResolvedValue(streamingOk([sseLine({ audio: { data: 'QUJD' } })]))
    const client = unwrapClient()

    const result = await client.generateMusic({ prompt: 'x', length: 'clip', format: 'wav' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.metadata.mimeType).toBe('audio/wav')
    }
  })
})

describe('audio client — error handling', () => {
  it('errors clearly when no audio data is present in the stream', async () => {
    mockFetch.mockResolvedValue(streamingOk(['data: [DONE]\n\n']))
    const client = unwrapClient()

    const result = await client.generateVoice({ prompt: 'hi', voice: 'alloy', format: 'wav' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('AUDIO_API_ERROR')
    }
  })

  it('classifies a non-OK HTTP response as an AudioAPIError with the status code', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      body: null,
      text: async () => 'Unauthorized',
    })
    const client = unwrapClient()

    const result = await client.generateVoice({ prompt: 'hi', voice: 'alloy', format: 'wav' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('AUDIO_API_ERROR')
      expect((result.error as { statusCode?: number }).statusCode).toBe(401)
    }
  })

  it('errors when the response is ok but has no body', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, body: null, text: async () => '' })
    const client = unwrapClient()

    const result = await client.generateMusic({ prompt: 'x', length: 'clip', format: 'wav' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('AUDIO_API_ERROR')
    }
  })

  it('classifies a fetch/network failure as a NetworkError', async () => {
    mockFetch.mockRejectedValue(new Error('connect ECONNRESET 1.2.3.4:443'))
    const client = unwrapClient()

    const result = await client.generateVoice({ prompt: 'hi', voice: 'alloy', format: 'wav' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('NETWORK_ERROR')
    }
  })
})
