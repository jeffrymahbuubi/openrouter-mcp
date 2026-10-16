/**
 * Tests for the speech-model catalog lookup (U2).
 * Uses a mocked global `fetch` returning a trimmed copy of the real
 * `GET /models?output_modalities=speech` payload (captured 2026-10-16).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../utils/config'
import { createModelCatalog } from '../modelCatalog'

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
      architecture: { modality: 'text->speech', output_modalities: ['speech'] },
      supported_voices: ELEVEN_VOICES,
    },
    {
      id: 'elevenlabs/eleven-multilingual-v2',
      architecture: { modality: 'text->speech', output_modalities: ['speech'] },
      supported_voices: ELEVEN_VOICES,
    },
    {
      id: 'fish-audio/s1',
      architecture: { modality: 'text->speech', output_modalities: ['speech'] },
      supported_voices: null,
    },
  ],
}

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

function jsonOk(payload: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(payload),
    json: async () => payload,
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('modelCatalog.describeVoiceModel', () => {
  it('reports an ElevenLabs model as speech-only with its 21 voices', async () => {
    mockFetch.mockResolvedValue(jsonOk(CATALOG_PAYLOAD))
    const catalog = createModelCatalog(makeConfig())

    const result = await catalog.describeVoiceModel('elevenlabs/eleven-v3')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.speechOnly).toBe(true)
      expect(result.data.supportedVoices).toHaveLength(21)
      expect(result.data.supportedVoices).toContain('george')
    }
  })

  it('reports a speech-only model with no fixed voices as supportedVoices: null', async () => {
    mockFetch.mockResolvedValue(jsonOk(CATALOG_PAYLOAD))
    const catalog = createModelCatalog(makeConfig())

    const result = await catalog.describeVoiceModel('fish-audio/s1')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ speechOnly: true, supportedVoices: null })
    }
  })

  it('reports a model absent from the speech catalog as not speech-only', async () => {
    mockFetch.mockResolvedValue(jsonOk(CATALOG_PAYLOAD))
    const catalog = createModelCatalog(makeConfig())

    const result = await catalog.describeVoiceModel('openai/gpt-audio')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ speechOnly: false, supportedVoices: null })
    }
  })

  it('does not treat a multi-modality entry as speech-only', async () => {
    mockFetch.mockResolvedValue(
      jsonOk({
        data: [
          {
            id: 'some/multimodal',
            architecture: { output_modalities: ['text', 'speech'] },
            supported_voices: ['a'],
          },
        ],
      })
    )
    const catalog = createModelCatalog(makeConfig())

    const result = await catalog.describeVoiceModel('some/multimodal')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.speechOnly).toBe(false)
    }
  })

  it('GETs {baseUrl}/models?output_modalities=speech once for any number of lookups', async () => {
    mockFetch.mockResolvedValue(jsonOk(CATALOG_PAYLOAD))
    const catalog = createModelCatalog(
      makeConfig({ appUrl: 'https://app.example', appTitle: 'My App' })
    )

    await catalog.describeVoiceModel('elevenlabs/eleven-v3')
    await catalog.describeVoiceModel('fish-audio/s1')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/models?output_modalities=speech')
    expect(init.method ?? 'GET').toBe('GET')
    const headers = init.headers as Record<string, string>
    expect(headers['HTTP-Referer']).toBe('https://app.example')
    expect(headers['X-Title']).toBe('My App')
  })

  it('does not cache a failed lookup, so the next call retries', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' })
    mockFetch.mockResolvedValueOnce(jsonOk(CATALOG_PAYLOAD))
    const catalog = createModelCatalog(makeConfig())

    const first = await catalog.describeVoiceModel('elevenlabs/eleven-v3')
    const second = await catalog.describeVoiceModel('elevenlabs/eleven-v3')

    expect(first.success).toBe(false)
    expect(second.success).toBe(true)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('maps an HTTP 500 to AUDIO_API_ERROR with statusCode and the endpoint-override suggestion', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'upstream down' })
    const catalog = createModelCatalog(makeConfig())

    const result = await catalog.describeVoiceModel('elevenlabs/eleven-v3')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('AUDIO_API_ERROR')
      expect((result.error as { statusCode?: number }).statusCode).toBe(500)
      expect(result.error.suggestion).toContain('OPENROUTER_VOICE_ENDPOINT')
    }
  })

  it('maps a thrown TypeError to NETWORK_ERROR', async () => {
    mockFetch.mockRejectedValue(new TypeError('fetch failed'))
    const catalog = createModelCatalog(makeConfig())

    const result = await catalog.describeVoiceModel('elevenlabs/eleven-v3')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('NETWORK_ERROR')
    }
  })

  it('maps malformed JSON to AUDIO_API_ERROR at stage catalog_parse', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '<html>nope</html>' })
    const catalog = createModelCatalog(makeConfig())

    const result = await catalog.describeVoiceModel('elevenlabs/eleven-v3')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('AUDIO_API_ERROR')
      expect(result.error.context?.['stage']).toBe('catalog_parse')
    }
  })

  it('maps a payload without a data array to AUDIO_API_ERROR at stage catalog_parse', async () => {
    mockFetch.mockResolvedValue(jsonOk({ unexpected: true }))
    const catalog = createModelCatalog(makeConfig())

    const result = await catalog.describeVoiceModel('elevenlabs/eleven-v3')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.context?.['stage']).toBe('catalog_parse')
    }
  })
})
