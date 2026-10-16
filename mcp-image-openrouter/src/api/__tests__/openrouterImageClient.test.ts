/**
 * Tests for the OpenRouter image client (Stage-2 generation / editing).
 * Uses OpenRouter's dedicated Images API via a mocked global `fetch`.
 * Contract: docs/OPENROUTER_API.md §3.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../utils/config'
import { Logger } from '../../utils/logger'
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
    imageApiTimeout: 180000,
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

/** Calls to POST /images (the capability GET shares the same mocked fetch). */
function postCalls() {
  return mockFetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'POST')
}

function requestBody(callIndex = 0) {
  const init = postCalls()[callIndex]?.[1] as { body: string }
  return JSON.parse(init.body)
}

const GPT_ENDPOINTS = {
  id: 'openai/gpt-5-image',
  endpoints: [
    {
      supported_parameters: {
        aspect_ratio: { type: 'enum', values: ['1:1', '3:2', '2:3', 'auto'] },
        quality: { type: 'enum', values: ['auto', 'low', 'medium', 'high'] },
        background: { type: 'enum', values: ['auto', 'transparent', 'opaque'] },
      },
    },
  ],
}

/**
 * Routes the shared mocked fetch: GET (capability lookup) answers with the
 * given endpoints record or 404 (-> static fallback); POST answers `images`.
 */
function mockApi(images: unknown, endpoints?: unknown) {
  mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'GET') {
      return endpoints === undefined
        ? { ok: false, status: 404, json: async () => ({}), text: async () => '' }
        : { ok: true, status: 200, json: async () => endpoints, text: async () => '' }
    }
    return images
  })
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('generateImage — success & request shaping', () => {
  it('POSTs to {baseUrl}/images and decodes data[0].b64_json (raw base64)', async () => {
    const b64 = Buffer.from('hello-image').toString('base64')
    mockApi(imagesOk(b64))
    const client = unwrapClient()

    const result = await client.generateImage({ prompt: 'a cat' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.imageData.toString('utf8')).toBe('hello-image')
      expect(result.data.metadata.model).toBe('google/gemini-3.1-flash-image')
      expect(result.data.metadata.mimeType).toBe('image/png')
      expect(result.data.metadata.inputImageProvided).toBe(false)
    }

    const [url, init] = postCalls()[0] as [string, RequestInit]
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
    mockApi(imagesOk('QUJD'))
    const client = unwrapClient(makeConfig({ appUrl: 'https://app.example', appTitle: 'My App' }))

    await client.generateImage({ prompt: 'a cat' })

    const headers = postCalls()[0]?.[1]?.headers as Record<string, string>
    expect(headers['HTTP-Referer']).toBe('https://app.example')
    expect(headers['X-Title']).toBe('My App')
  })

  it('uses media_type from the response when present', async () => {
    mockApi(imagesOk('QUJD', 'image/webp'))
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
    mockApi(imagesOk('QUJD'))
    const client = unwrapClient()

    await client.generateImage({ prompt: 'a cat', quality: 'balanced' })

    expect(requestBody().model).toBe('google/gemini-3.1-flash-image')
  })

  it('uses OPENROUTER_IMAGE_MODEL_HQ for quality', async () => {
    mockApi(imagesOk('QUJD'))
    const client = unwrapClient()

    await client.generateImage({ prompt: 'a cat', quality: 'quality' })

    expect(requestBody().model).toBe('google/gemini-3-pro-image')
  })
})

describe('generateImage — D4 native params vs folding', () => {
  it('passes native aspect_ratio and resolution for a capable model', async () => {
    mockApi(imagesOk('QUJD'))
    const client = unwrapClient() // default imageModel = gemini-3.1-flash-image (supports both)

    await client.generateImage({ prompt: 'a cat', aspectRatio: '16:9', imageSize: '2K' })

    const body = requestBody()
    expect(body.aspect_ratio).toBe('16:9')
    expect(body.resolution).toBe('2K')
    expect(body.prompt).toBe('a cat') // not folded
  })

  it('drops imageSize (never folds it) when the model lacks resolution support', async () => {
    mockApi(imagesOk('QUJD'))
    const client = unwrapClient(makeConfig({ imageModel: 'google/gemini-2.5-flash-image' }))

    const result = await client.generateImage({ prompt: 'a cat', imageSize: '4K' })

    const body = requestBody()
    expect(body.resolution).toBeUndefined()
    expect(body.prompt).toBe('a cat')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.metadata.requested.imageSize).toBe('4K')
      expect(result.data.metadata.delivered.imageSize).toBeNull()
      expect(result.data.metadata.warnings[0]).toContain('4K')
    }
  })
})

describe('generateImage — GPT image models', () => {
  const gptConfig = () => makeConfig({ imageModel: 'openai/gpt-5-image' })

  it('maps 16:9 to 3:2, drops 4K and reports requested vs delivered with warnings', async () => {
    mockApi(imagesOk('QUJD'), GPT_ENDPOINTS)
    const client = unwrapClient(gptConfig())

    const result = await client.generateImage({
      prompt: 'a flowchart',
      aspectRatio: '16:9',
      imageSize: '4K',
    })

    const body = requestBody()
    expect(body.aspect_ratio).toBe('3:2')
    expect(body.resolution).toBeUndefined()
    expect(body.prompt).toBe('a flowchart')
    expect(result.success).toBe(true)
    if (result.success) {
      const { metadata } = result.data
      expect(metadata.requested).toEqual({ aspectRatio: '16:9', imageSize: '4K' })
      expect(metadata.delivered).toEqual({ aspectRatio: '3:2', imageSize: null })
      expect(metadata.warnings).toHaveLength(2)
    }
  })

  it('sends quality high only on the quality tier', async () => {
    mockApi(imagesOk('QUJD'), GPT_ENDPOINTS)
    const client = unwrapClient(gptConfig())

    await client.generateImage({ prompt: 'a cat', quality: 'quality' })
    await client.generateImage({ prompt: 'a cat', quality: 'fast' })

    expect(requestBody(0).quality).toBe('high')
    expect(requestBody(1).quality).toBeUndefined()
  })

  it('derives the quality tier from the configured default when the caller sends none', async () => {
    mockApi(imagesOk('QUJD'), GPT_ENDPOINTS)
    const client = unwrapClient(
      makeConfig({
        imageModel: 'openai/gpt-5-image',
        imageModelHq: 'openai/gpt-5-image',
        imageQuality: 'quality',
      })
    )

    await client.generateImage({ prompt: 'a cat' })

    expect(requestBody().quality).toBe('high')
  })

  it('lets the test-only openrouterQuality override the tier-derived high', async () => {
    mockApi(imagesOk('QUJD'), GPT_ENDPOINTS)
    const client = unwrapClient(gptConfig())

    await client.generateImage({ prompt: 'a cat', quality: 'quality', openrouterQuality: 'medium' })

    expect(requestBody().quality).toBe('medium')
  })

  it('sends background natively and warns for an unsupported explicit outputFormat', async () => {
    mockApi(imagesOk('QUJD'), GPT_ENDPOINTS)
    const client = unwrapClient(gptConfig())

    const result = await client.generateImage({
      prompt: 'a cat',
      background: 'opaque',
      outputFormat: 'png',
      outputFormatExplicit: true,
    })

    const body = requestBody()
    expect(body.background).toBe('opaque')
    expect(body.output_format).toBeUndefined()
    expect(result.success && result.data.metadata.warnings.join(' ')).toContain('png')
  })

  it('reuses the capability lookup across calls (one GET per model)', async () => {
    mockApi(imagesOk('QUJD'), GPT_ENDPOINTS)
    const client = unwrapClient(gptConfig())

    await client.generateImage({ prompt: 'a' })
    await client.generateImage({ prompt: 'b' })

    const gets = mockFetch.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'GET')
    expect(gets).toHaveLength(1)
  })
})

describe('generateImage — unknown models and metadata', () => {
  it('folds aspect into the prompt and adds a white-background hint on an unknown model', async () => {
    mockApi(imagesOk('QUJD'))
    const client = unwrapClient(makeConfig({ imageModel: 'acme/unknown-image' }))

    const result = await client.generateImage({
      prompt: 'a cat',
      aspectRatio: '16:9',
      background: 'opaque',
    })

    const body = requestBody()
    expect(body.aspect_ratio).toBeUndefined()
    expect(body.background).toBeUndefined()
    expect(body.prompt).toContain('16:9')
    expect(body.prompt.toLowerCase()).toContain('white background')
    expect(result.success && result.data.metadata.warnings).toHaveLength(2)
  })

  it('reports no warnings and null/null pairs when nothing special was requested', async () => {
    mockApi(imagesOk('QUJD'))
    const client = unwrapClient()

    const result = await client.generateImage({ prompt: 'a cat' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.metadata.warnings).toEqual([])
      expect(result.data.metadata.requested).toEqual({ aspectRatio: null, imageSize: null })
      expect(result.data.metadata.delivered).toEqual({ aspectRatio: null, imageSize: null })
    }
  })

  it('stamps a positive durationMs measured around the request', async () => {
    vi.useFakeTimers()
    try {
      mockFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return { ok: false, status: 404, json: async () => ({}), text: async () => '' }
        }
        await new Promise((resolve) => setTimeout(resolve, 1500))
        return imagesOk('QUJD')
      })
      const client = unwrapClient()

      const pending = client.generateImage({ prompt: 'a cat' })
      await vi.advanceTimersByTimeAsync(1500)
      const result = await pending

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.metadata.durationMs).toBeGreaterThanOrEqual(1500)
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('generateImage — editing & soft hints', () => {
  it('attaches an input image via input_references for image-to-image', async () => {
    mockApi(imagesOk('QUJD'))
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
    mockApi(imagesOk('QUJD'))
    const client = unwrapClient()

    const result = await client.generateImage({ prompt: 'a cat', useGoogleSearch: true })

    expect(result.success).toBe(true)
  })
})

describe('generateImage — error handling', () => {
  it('errors clearly when the response has no image data', async () => {
    mockApi({
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
    mockApi({
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

  it.each([
    'TimeoutError',
    'AbortError',
  ])('classifies a %s abort as TIMEOUT_ERROR naming OPENROUTER_IMAGE_TIMEOUT_MS', async (name) => {
    const abort = new Error('The operation was aborted due to timeout')
    abort.name = name
    mockFetch.mockRejectedValue(abort)
    const client = unwrapClient(makeConfig({ imageApiTimeout: 90000 }))

    const result = await client.generateImage({ prompt: 'a cat' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('TIMEOUT_ERROR')
      expect(result.error.suggestion).toContain('OPENROUTER_IMAGE_TIMEOUT_MS')
      expect(result.error.suggestion).toContain('90000')
    }
  })

  it('aborts the image request with imageApiTimeout, not apiTimeout', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    mockApi(imagesOk('QUJD'))
    const client = unwrapClient(makeConfig({ apiTimeout: 30000, imageApiTimeout: 90000 }))

    await client.generateImage({ prompt: 'a cat' })

    expect(timeoutSpy).toHaveBeenCalledWith(90000)
    timeoutSpy.mockRestore()
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
