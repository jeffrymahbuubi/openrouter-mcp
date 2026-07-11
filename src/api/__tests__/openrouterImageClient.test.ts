/**
 * Tests for the OpenRouter image client (Stage-2 generation / editing).
 * Uses OpenRouter's dedicated Images API via a mocked global `fetch`.
 * Contract: docs/OPENROUTER_API.md §3.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../utils/config'
import { createOpenRouterImageClient } from '../openrouterImageClient'

const mockFetch = vi.fn()

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    openrouterApiKey: 'sk-or-test-key-12345',
    baseUrl: 'https://openrouter.ai/api/v1',
    textModel: 'google/gemini-3.5-flash',
    imageModel: 'google/gemini-3.1-flash-image',
    imageModelHq: 'google/gemini-3-pro-image',
    imageOutputDir: './output',
    apiTimeout: 30000,
    skipPromptEnhancement: false,
    imageQuality: 'fast',
    ...overrides,
  }
}

function unwrapClient(config: Config = makeConfig()) {
  const result = createOpenRouterImageClient(config)
  if (!result.success) {
    throw new Error(`expected client, got error: ${result.error.message}`)
  }
  return result.data
}

function imagesOk(b64: string, mediaType?: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      created: 1,
      data: [{ b64_json: b64, ...(mediaType ? { media_type: mediaType } : {}) }],
      usage: {},
    }),
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

describe('generateImage — success & request shaping', () => {
  it('POSTs to {baseUrl}/images and decodes data[0].b64_json (raw base64)', async () => {
    const b64 = Buffer.from('hello-image').toString('base64')
    mockFetch.mockResolvedValue(imagesOk(b64))
    const client = unwrapClient()

    const result = await client.generateImage({ prompt: 'a cat' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.imageData.toString('utf8')).toBe('hello-image')
      expect(result.data.metadata.model).toBe('google/gemini-3.1-flash-image')
      expect(result.data.metadata.mimeType).toBe('image/png')
      expect(result.data.metadata.inputImageProvided).toBe(false)
    }

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/images')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-or-test-key-12345'
    )
    const body = requestBody()
    expect(body.model).toBe('google/gemini-3.1-flash-image')
    expect(body.prompt).toBe('a cat')
    expect(body.n).toBe(1)
  })

  it('sends attribution headers when configured', async () => {
    mockFetch.mockResolvedValue(imagesOk('QUJD'))
    const client = unwrapClient(makeConfig({ appUrl: 'https://app.example', appTitle: 'My App' }))

    await client.generateImage({ prompt: 'a cat' })

    const headers = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers['HTTP-Referer']).toBe('https://app.example')
    expect(headers['X-Title']).toBe('My App')
  })

  it('uses media_type from the response when present', async () => {
    mockFetch.mockResolvedValue(imagesOk('QUJD', 'image/webp'))
    const client = unwrapClient()

    const result = await client.generateImage({ prompt: 'a cat' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.metadata.mimeType).toBe('image/webp')
    }
  })
})

describe('generateImage — quality tier model selection', () => {
  it('uses the base image model for fast/balanced', async () => {
    mockFetch.mockResolvedValue(imagesOk('QUJD'))
    const client = unwrapClient()

    await client.generateImage({ prompt: 'a cat', quality: 'balanced' })

    expect(requestBody().model).toBe('google/gemini-3.1-flash-image')
  })

  it('uses OPENROUTER_IMAGE_MODEL_HQ for quality', async () => {
    mockFetch.mockResolvedValue(imagesOk('QUJD'))
    const client = unwrapClient()

    await client.generateImage({ prompt: 'a cat', quality: 'quality' })

    expect(requestBody().model).toBe('google/gemini-3-pro-image')
  })
})

describe('generateImage — D4 native params vs folding', () => {
  it('passes native aspect_ratio and resolution for a capable model', async () => {
    mockFetch.mockResolvedValue(imagesOk('QUJD'))
    const client = unwrapClient() // default imageModel = gemini-3.1-flash-image (supports both)

    await client.generateImage({ prompt: 'a cat', aspectRatio: '16:9', imageSize: '2K' })

    const body = requestBody()
    expect(body.aspect_ratio).toBe('16:9')
    expect(body.resolution).toBe('2K')
    expect(body.prompt).toBe('a cat') // not folded
  })

  it('folds imageSize into the prompt when the model lacks resolution support', async () => {
    mockFetch.mockResolvedValue(imagesOk('QUJD'))
    const client = unwrapClient(makeConfig({ imageModel: 'google/gemini-2.5-flash-image' }))

    await client.generateImage({ prompt: 'a cat', imageSize: '4K' })

    const body = requestBody()
    expect(body.resolution).toBeUndefined()
    expect(body.prompt).toContain('4K')
    // 2.5-flash still supports aspect_ratio natively
  })
})

describe('generateImage — editing & soft hints', () => {
  it('attaches an input image via input_references for image-to-image', async () => {
    mockFetch.mockResolvedValue(imagesOk('QUJD'))
    const client = unwrapClient()

    const result = await client.generateImage({
      prompt: 'make it watercolor',
      inputImage: 'QUJD',
      inputImageMimeType: 'image/png',
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.metadata.inputImageProvided).toBe(true)
    }
    expect(requestBody().input_references).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ])
  })

  it('treats useGoogleSearch as a soft hint without erroring', async () => {
    mockFetch.mockResolvedValue(imagesOk('QUJD'))
    const client = unwrapClient()

    const result = await client.generateImage({ prompt: 'a cat', useGoogleSearch: true })

    expect(result.success).toBe(true)
  })
})

describe('generateImage — error handling', () => {
  it('errors clearly when the response has no image data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ created: 1, data: [], usage: {} }),
      text: async () => '',
    })
    const client = unwrapClient()

    const result = await client.generateImage({ prompt: 'a cat' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('IMAGE_API_ERROR')
    }
  })

  it('classifies a non-OK HTTP response as an ImageAPIError with the status code', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Unauthorized' } }),
      text: async () => 'Unauthorized',
    })
    const client = unwrapClient()

    const result = await client.generateImage({ prompt: 'a cat' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('IMAGE_API_ERROR')
      expect((result.error as { statusCode?: number }).statusCode).toBe(401)
    }
  })

  it('classifies a fetch/network failure as a NetworkError', async () => {
    mockFetch.mockRejectedValue(new Error('connect ECONNRESET 1.2.3.4:443'))
    const client = unwrapClient()

    const result = await client.generateImage({ prompt: 'a cat' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('NETWORK_ERROR')
    }
  })
})
