/**
 * Tests for `generateVoice` routing between the chat-completions path and the
 * `/audio/speech` path (U4). Mocks `fetch` per URL (`/models`, `/audio/speech`,
 * `/chat/completions`). Contract: docs/OPENROUTER_API.md §2, §3, §6.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../utils/config'
import { createOpenRouterAudioClient } from '../openrouterAudioClient'

const mockFetch = vi.fn()

const ELEVEN_VOICES = [
  'george',
  'sarah',
  'adam',
  'alice',
  'bella',
  'bill',
  'brian',
  'callum',
  'charlie',
  'chris',
  'daniel',
  'eric',
  'harry',
  'jessica',
  'laura',
  'liam',
  'lily',
  'matilda',
  'river',
  'roger',
  'will',
]

const CATALOG_PAYLOAD = {
  data: [
    {
      id: 'elevenlabs/eleven-v3',
      architecture: { output_modalities: ['speech'] },
      supported_voices: ELEVEN_VOICES,
    },
    {
      id: 'fish-audio/s1',
      architecture: { output_modalities: ['speech'] },
      supported_voices: null,
    },
  ],
}

const MP3_BYTES = Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.alloc(2000, 1)])

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    openrouterApiKey: 'sk-or-test-key-12345',
    baseUrl: 'https://openrouter.ai/api/v1',
    voiceModel: 'openai/gpt-audio',
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

function unwrapClient(config: Config) {
  const result = createOpenRouterAudioClient(config)
  if (!result.success) {
    throw new Error(`expected client, got error: ${result.error.message}`)
  }
  return result.data
}

function chatStreamOk() {
  const line = `data: ${JSON.stringify({ choices: [{ delta: { audio: { data: 'QUJD', transcript: 'Hi' } } }] })}\n\n`
  const encoder = new TextEncoder()
  let sent = false
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(encoder.encode(line))
        } else {
          controller.close()
        }
      },
    }),
    text: async () => '',
  }
}

function speechOk(body: Buffer, headers: Record<string, string>) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    arrayBuffer: async () =>
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    text: async () => '',
  }
}

interface RouteMocks {
  catalog?: () => unknown
  speech?: () => unknown
  chat?: () => unknown
}

function routeFetch(routes: RouteMocks) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/models')) {
      return (
        routes.catalog?.() ?? {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(CATALOG_PAYLOAD),
        }
      )
    }
    if (url.endsWith('/audio/speech')) {
      return (
        routes.speech?.() ??
        speechOk(MP3_BYTES, { 'Content-Type': 'audio/mpeg', 'X-Generation-Id': 'gen-1' })
      )
    }
    if (url.endsWith('/chat/completions')) {
      return routes.chat?.() ?? chatStreamOk()
    }
    throw new Error(`unexpected URL ${url}`)
  })
}

function callsTo(suffix: string) {
  return mockFetch.mock.calls.filter(([url]) => (url as string).endsWith(suffix))
}

function lastBody(suffix: string) {
  const calls = callsTo(suffix)
  const init = calls[calls.length - 1]?.[1] as { body: string }
  return JSON.parse(init.body)
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('generateVoice — routing', () => {
  it('keeps the GPT Audio chat path for the default model in auto mode (AE2)', async () => {
    routeFetch({})
    const client = unwrapClient(makeConfig())

    const result = await client.generateVoice({
      prompt: 'Say hello',
      voice: 'alloy',
      format: 'wav',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.audioData.subarray(0, 4).toString('ascii')).toBe('RIFF')
      expect(result.data.metadata.mimeType).toBe('audio/wav')
      expect(result.data.metadata.transcript).toBe('Hi')
      expect(result.data.metadata.endpoint).toBe('chat_completions')
    }
    expect(callsTo('/models?output_modalities=speech')).toHaveLength(1)
    expect(callsTo('/audio/speech')).toHaveLength(0)
    expect(callsTo('/chat/completions')).toHaveLength(1)
    const body = lastBody('/chat/completions')
    expect(body.model).toBe('openai/gpt-audio')
    expect(body.modalities).toEqual(['text', 'audio'])
    expect(body.stream).toBe(true)
    expect(body.audio).toEqual({ voice: 'alloy', format: 'pcm16' })
    expect(body.messages).toEqual([{ role: 'user', content: 'Say hello' }])
  })

  it('routes a speech-only model to /audio/speech and never calls /chat/completions (AE1)', async () => {
    routeFetch({})
    const client = unwrapClient(makeConfig({ voiceModel: 'elevenlabs/eleven-v3' }))

    const result = await client.generateVoice({ prompt: 'Hello', voice: 'george', format: 'mp3' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.audioData.equals(MP3_BYTES)).toBe(true)
      expect(result.data.metadata.model).toBe('elevenlabs/eleven-v3')
      expect(result.data.metadata.voice).toBe('george')
      expect(result.data.metadata.mimeType).toBe('audio/mpeg')
      expect(result.data.metadata.endpoint).toBe('speech')
      expect(result.data.metadata.generationId).toBe('gen-1')
      expect(result.data.metadata.transcript).toBe('')
    }
    expect(callsTo('/audio/speech')).toHaveLength(1)
    expect(callsTo('/chat/completions')).toHaveLength(0)
    expect(lastBody('/audio/speech')).toEqual({
      model: 'elevenlabs/eleven-v3',
      input: 'Hello',
      voice: 'george',
      response_format: 'mp3',
    })
  })

  it('fails fast with INPUT_VALIDATION_ERROR listing the supported voices before any paid call (AE3)', async () => {
    routeFetch({})
    const client = unwrapClient(makeConfig({ voiceModel: 'elevenlabs/eleven-v3' }))

    const result = await client.generateVoice({ prompt: 'Hello', voice: 'alloy', format: 'wav' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('INPUT_VALIDATION_ERROR')
      expect(result.error.message).toContain('elevenlabs/eleven-v3')
      expect(result.error.message).toContain('alloy')
      expect(result.error.message).toContain('george')
      expect(result.error.message).toContain('will')
    }
    expect(callsTo('/audio/speech')).toHaveLength(0)
    expect(callsTo('/chat/completions')).toHaveLength(0)
  })

  it('skips the voice check when the catalog lists no fixed voices', async () => {
    routeFetch({})
    const client = unwrapClient(makeConfig({ voiceModel: 'fish-audio/s1' }))

    const result = await client.generateVoice({ prompt: 'Hello', voice: 'whatever', format: 'mp3' })

    expect(result.success).toBe(true)
    expect(lastBody('/audio/speech').voice).toBe('whatever')
  })

  it('forces the speech path without a catalog fetch or voice check when voiceEndpoint is "speech"', async () => {
    routeFetch({})
    const client = unwrapClient(
      makeConfig({ voiceModel: 'some/unknown-model', voiceEndpoint: 'speech' })
    )

    const result = await client.generateVoice({ prompt: 'Hello', voice: 'anything', format: 'mp3' })

    expect(result.success).toBe(true)
    expect(callsTo('/models?output_modalities=speech')).toHaveLength(0)
    expect(callsTo('/audio/speech')).toHaveLength(1)
    expect(lastBody('/audio/speech').voice).toBe('anything')
  })

  it('forces the chat path without a catalog fetch when voiceEndpoint is "chat"', async () => {
    routeFetch({})
    const client = unwrapClient(
      makeConfig({ voiceModel: 'elevenlabs/eleven-v3', voiceEndpoint: 'chat' })
    )

    const result = await client.generateVoice({ prompt: 'Hello', voice: 'alloy', format: 'wav' })

    expect(result.success).toBe(true)
    expect(callsTo('/models?output_modalities=speech')).toHaveLength(0)
    expect(callsTo('/audio/speech')).toHaveLength(0)
    expect(callsTo('/chat/completions')).toHaveLength(1)
  })

  it('surfaces a catalog failure in auto mode with the override suggestion and makes no generation call', async () => {
    routeFetch({ catalog: () => ({ ok: false, status: 500, text: async () => 'down' }) })
    const client = unwrapClient(makeConfig({ voiceModel: 'elevenlabs/eleven-v3' }))

    const result = await client.generateVoice({ prompt: 'Hello', voice: 'george', format: 'mp3' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('AUDIO_API_ERROR')
      expect(result.error.suggestion).toContain('OPENROUTER_VOICE_ENDPOINT')
    }
    expect(callsTo('/audio/speech')).toHaveLength(0)
    expect(callsTo('/chat/completions')).toHaveLength(0)
  })

  it('looks the catalog up once across several generateVoice calls', async () => {
    routeFetch({})
    const client = unwrapClient(makeConfig({ voiceModel: 'elevenlabs/eleven-v3' }))

    await client.generateVoice({ prompt: 'one', voice: 'george', format: 'mp3' })
    await client.generateVoice({ prompt: 'two', voice: 'sarah', format: 'mp3' })

    expect(callsTo('/models?output_modalities=speech')).toHaveLength(1)
    expect(callsTo('/audio/speech')).toHaveLength(2)
  })

  it('wraps ElevenLabs PCM into a WAV for format "wav" on the speech path', async () => {
    routeFetch({ speech: () => speechOk(Buffer.alloc(1000, 2), { 'Content-Type': 'audio/pcm' }) })
    const client = unwrapClient(makeConfig({ voiceModel: 'elevenlabs/eleven-v3' }))

    const result = await client.generateVoice({ prompt: 'Hello', voice: 'george', format: 'wav' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.metadata.mimeType).toBe('audio/wav')
      expect(result.data.audioData.length).toBe(1044)
    }
    expect(lastBody('/audio/speech').response_format).toBe('pcm')
  })
})
