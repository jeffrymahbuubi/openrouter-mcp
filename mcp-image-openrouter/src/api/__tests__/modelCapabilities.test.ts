/**
 * Tests for per-model capability resolution (live endpoints record -> static
 * map -> conservative default). Fixtures under ./fixtures are real, public
 * `GET /api/v1/images/models/{id}/endpoints` responses captured 2026-10-16.
 */

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../utils/config'
import { Logger } from '../../utils/logger'
import { createCapabilityResolver } from '../modelCapabilities'

const mockFetch = vi.fn()

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))
}

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
    inlinePreview: true,
    ...overrides,
  }
}

function jsonOk(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload, text: async () => '' }
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolveCapabilities — live endpoints record', () => {
  it('reads aspect ratios, quality and background for openai/gpt-5-image', async () => {
    mockFetch.mockResolvedValue(jsonOk(fixture('gpt-5-image.endpoints.json')))
    const resolver = createCapabilityResolver(makeConfig())

    const caps = await resolver.resolve('openai/gpt-5-image')

    expect(caps.aspectRatios).toEqual(expect.arrayContaining(['1:1', '3:2', '2:3']))
    expect(caps.resolutions).toBeNull()
    expect(caps.outputFormats).toBeNull()
    expect(caps.quality).toBe(true)
    expect(caps.background).toBe(true)
  })

  it('lists svg for a vector model that exposes output_format', async () => {
    mockFetch.mockResolvedValue(jsonOk(fixture('recraft-v4-vector.endpoints.json')))
    const resolver = createCapabilityResolver(makeConfig())

    const caps = await resolver.resolve('recraft/recraft-v4-vector')

    expect(caps.outputFormats).toContain('svg')
    expect(caps.quality).toBe(false)
    expect(caps.background).toBe(false)
  })

  it('unions resolutions across endpoints (AI Studio 1K,2K,4K + Vertex 1K,2K)', async () => {
    mockFetch.mockResolvedValue(jsonOk(fixture('gemini-3-pro-image.endpoints.json')))
    const resolver = createCapabilityResolver(makeConfig())

    const caps = await resolver.resolve('google/gemini-3-pro-image')

    expect(caps.resolutions).toEqual(expect.arrayContaining(['1K', '2K', '4K']))
    expect(new Set(caps.resolutions).size).toBe(caps.resolutions?.length)
  })

  it('requests GET {baseUrl}/images/models/<id>/endpoints with a literal slash and auth', async () => {
    mockFetch.mockResolvedValue(jsonOk(fixture('gpt-5-image.endpoints.json')))
    const resolver = createCapabilityResolver(makeConfig())

    await resolver.resolve('openai/gpt-5-image')

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/images/models/openai/gpt-5-image/endpoints')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-or-test-key-12345'
    )
  })

  it('percent-encodes characters other than the slash in the model id', async () => {
    mockFetch.mockResolvedValue(jsonOk(fixture('gpt-5-image.endpoints.json')))
    const resolver = createCapabilityResolver(makeConfig())

    await resolver.resolve('vendor/model name:v1')

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      'https://openrouter.ai/api/v1/images/models/vendor/model%20name%3Av1/endpoints'
    )
  })

  it('does not fetch again for a model it already resolved', async () => {
    mockFetch.mockResolvedValue(jsonOk(fixture('gpt-5-image.endpoints.json')))
    const resolver = createCapabilityResolver(makeConfig())

    const first = await resolver.resolve('openai/gpt-5-image')
    const second = await resolver.resolve('openai/gpt-5-image')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
  })
})

describe('resolveCapabilities — fallbacks never fail generation', () => {
  it('falls back to the static record on HTTP 404 and logs a warning', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => '',
    })
    const resolver = createCapabilityResolver(makeConfig())

    const caps = await resolver.resolve('openai/gpt-5-image')

    expect(caps.aspectRatios).toEqual(['1:1', '3:2', '2:3', 'auto'])
    expect(caps.resolutions).toBeNull()
    expect(caps.quality).toBe(true)
    expect(caps.background).toBe(true)
    expect(warn).toHaveBeenCalled()
  })

  it('falls back to the conservative default for an unknown model on network rejection', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    mockFetch.mockRejectedValue(new Error('connect ECONNRESET'))
    const resolver = createCapabilityResolver(makeConfig())

    const caps = await resolver.resolve('acme/unknown-image')

    expect(caps).toEqual({
      aspectRatios: null,
      resolutions: null,
      outputFormats: null,
      quality: false,
      background: false,
    })
  })

  it('falls back without throwing on malformed JSON', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
      text: async () => '',
    })
    const resolver = createCapabilityResolver(makeConfig())

    const caps = await resolver.resolve('google/gemini-3.1-flash-image')

    expect(caps.aspectRatios).toContain('16:9')
    expect(caps.resolutions).toContain('4K')
  })

  it('falls back when the record has no endpoints', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    mockFetch.mockResolvedValue(jsonOk({ id: 'acme/unknown-image', endpoints: [] }))
    const resolver = createCapabilityResolver(makeConfig())

    const caps = await resolver.resolve('acme/unknown-image')

    expect(caps.aspectRatios).toBeNull()
    expect(caps.quality).toBe(false)
  })

  it('caches the fallback record too, so a failing lookup is not retried', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    mockFetch.mockRejectedValue(new Error('offline'))
    const resolver = createCapabilityResolver(makeConfig())

    await resolver.resolve('acme/unknown-image')
    await resolver.resolve('acme/unknown-image')

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
