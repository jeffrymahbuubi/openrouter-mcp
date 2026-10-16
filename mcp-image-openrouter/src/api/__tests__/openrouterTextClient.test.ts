/**
 * Tests for the OpenRouter text client (Stage-1 prompt enhancement).
 * The `openai` SDK is mocked; we assert request shaping and response handling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../utils/config'
import { createOpenRouterTextClient } from '../openrouterTextClient'

const { mockCreate, constructorArgs } = vi.hoisted(() => {
  const mockCreate = vi.fn()
  const constructorArgs: unknown[] = []
  return { mockCreate, constructorArgs }
})

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } }
    constructor(opts: unknown) {
      constructorArgs.push(opts)
    }
  },
}))

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
  const result = createOpenRouterTextClient(config)
  if (!result.success) {
    throw new Error(`expected client, got error: ${result.error.message}`)
  }
  return result.data
}

function chatResponse(content: string | null) {
  return { choices: [{ message: { role: 'assistant', content } }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  constructorArgs.length = 0
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('createOpenRouterTextClient', () => {
  it('constructs the OpenAI client against the OpenRouter base URL with attribution headers', () => {
    unwrapClient(makeConfig({ appUrl: 'https://app.example', appTitle: 'My App' }))

    expect(constructorArgs[0]).toEqual(
      expect.objectContaining({
        apiKey: 'sk-or-test-key-12345',
        baseURL: 'https://openrouter.ai/api/v1',
        defaultHeaders: expect.objectContaining({
          'HTTP-Referer': 'https://app.example',
          'X-Title': 'My App',
        }),
      })
    )
  })

  it('omits attribution headers when not configured', () => {
    unwrapClient(makeConfig())
    const passed = constructorArgs[0] as { defaultHeaders?: Record<string, string> }
    expect(passed.defaultHeaders?.['HTTP-Referer']).toBeUndefined()
    expect(passed.defaultHeaders?.['X-Title']).toBeUndefined()
  })
})

describe('generateText', () => {
  it('returns the enhanced text from choices[0].message.content', async () => {
    mockCreate.mockResolvedValue(chatResponse('  enhanced prompt text  '))
    const client = unwrapClient()

    const result = await client.generateText('a cat')

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe('enhanced prompt text')
    }
  })

  it('uses the configured text model and sends the prompt as a user message', async () => {
    mockCreate.mockResolvedValue(chatResponse('ok'))
    const client = unwrapClient(makeConfig({ textModel: 'google/gemini-2.5-flash' }))

    await client.generateText('a cat')

    const request = mockCreate.mock.calls[0]?.[0]
    expect(request.model).toBe('google/gemini-2.5-flash')
    const userMessage = request.messages.find((m: { role: string }) => m.role === 'user')
    expect(userMessage?.content).toBe('a cat')
  })

  it('includes the system instruction as a system message when provided', async () => {
    mockCreate.mockResolvedValue(chatResponse('ok'))
    const client = unwrapClient()

    await client.generateText('a cat', { systemInstruction: 'You are a prompt engineer.' })

    const request = mockCreate.mock.calls[0]?.[0]
    const systemMessage = request.messages.find((m: { role: string }) => m.role === 'system')
    expect(systemMessage?.content).toBe('You are a prompt engineer.')
  })

  it('attaches an input image as an image_url data URL for edit-context enhancement', async () => {
    mockCreate.mockResolvedValue(chatResponse('ok'))
    const client = unwrapClient()

    await client.generateText('describe edits', {
      inputImage: 'QUJD',
      inputImageMimeType: 'image/png',
    })

    const request = mockCreate.mock.calls[0]?.[0]
    const userMessage = request.messages.find((m: { role: string }) => m.role === 'user')
    expect(Array.isArray(userMessage.content)).toBe(true)
    expect(userMessage.content).toEqual(
      expect.arrayContaining([
        { type: 'text', text: 'describe edits' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,QUJD' },
        },
      ])
    )
  })

  it('returns an error for an empty prompt without calling the API', async () => {
    const client = unwrapClient()

    const result = await client.generateText('   ')

    expect(result.success).toBe(false)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns an error when the response contains no usable content', async () => {
    mockCreate.mockResolvedValue(chatResponse(''))
    const client = unwrapClient()

    const result = await client.generateText('a cat')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('IMAGE_API_ERROR')
    }
  })

  it('classifies a network failure as a NetworkError', async () => {
    mockCreate.mockRejectedValue(new Error('connect ECONNRESET 1.2.3.4:443'))
    const client = unwrapClient()

    const result = await client.generateText('a cat')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('NETWORK_ERROR')
    }
  })

  it('classifies an API failure as an ImageAPIError carrying the status code', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const client = unwrapClient()

    const result = await client.generateText('a cat')

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.code).toBe('IMAGE_API_ERROR')
      expect((result.error as { statusCode?: number }).statusCode).toBe(401)
    }
  })
})

describe('validateConnection', () => {
  it('resolves Ok when the client is constructed', async () => {
    const client = unwrapClient()
    const result = await client.validateConnection()
    expect(result.success).toBe(true)
  })
})
