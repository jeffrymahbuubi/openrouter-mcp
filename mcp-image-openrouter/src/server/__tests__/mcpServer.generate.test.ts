/**
 * Integration tests for the full generate_image flow through MCPServerImpl.
 *
 * The two OpenRouter client factories and the file manager are mocked so the
 * test exercises the real wiring (config → clients → structured prompt →
 * image generation → save → response) without network or disk I/O.
 */

import { Jimp } from 'jimp'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Err, Ok } from '../../types/result'
import { ImageAPIError } from '../../utils/errors'

const { mockGenerateText, mockGenerateImage, mockSaveImage, mockGenerateFileName } = vi.hoisted(
  () => ({
    mockGenerateText: vi.fn(),
    mockGenerateImage: vi.fn(),
    mockSaveImage: vi.fn(),
    mockGenerateFileName: vi.fn(() => 'image-test.png'),
  })
)

vi.mock('../../api/openrouterTextClient', () => ({
  createOpenRouterTextClient: vi.fn(() => ({
    success: true,
    data: {
      generateText: mockGenerateText,
      validateConnection: vi.fn(async () => ({ success: true, data: true })),
    },
  })),
}))

vi.mock('../../api/openrouterImageClient', () => ({
  createOpenRouterImageClient: vi.fn(() => ({
    success: true,
    data: { generateImage: mockGenerateImage },
  })),
}))

vi.mock('../../business/fileManager', () => ({
  createFileManager: vi.fn(() => ({
    saveImage: mockSaveImage,
    ensureDirectoryExists: vi.fn(() => ({ success: true, data: undefined })),
    generateFileName: mockGenerateFileName,
  })),
}))

import { MCPServerImpl } from '../mcpServer'

const METADATA = {
  model: 'google/gemini-3.1-flash-image',
  provider: 'openrouter',
  prompt: 'enhanced prompt',
  mimeType: 'image/png',
  timestamp: new Date('2026-07-11T00:00:00.000Z'),
  inputImageProvided: false,
  durationMs: 4321,
  requested: { aspectRatio: null, imageSize: null },
  delivered: { aspectRatio: null, imageSize: null },
  warnings: [] as string[],
}

// A real PNG so the (real) thumbnail generator can produce an inline preview.
let realPng: Buffer

const ENV_KEYS = [
  'OPENROUTER_API_KEY',
  'SKIP_PROMPT_ENHANCEMENT',
  'IMAGE_OUTPUT_DIR',
  'IMAGE_INLINE_PREVIEW',
] as const
const savedEnv: Record<string, string | undefined> = {}

beforeAll(async () => {
  realPng = await new Jimp({ width: 600, height: 400, color: 0x2288ccff }).getBuffer('image/png')
})

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  process.env.OPENROUTER_API_KEY = 'sk-or-test-key-12345'

  vi.clearAllMocks()
  mockGenerateFileName.mockReturnValue('image-test.png')
  mockGenerateText.mockResolvedValue(Ok('enhanced prompt'))
  mockGenerateImage.mockResolvedValue(Ok({ imageData: realPng, metadata: METADATA }))
  mockSaveImage.mockResolvedValue(Ok('/abs/output/image-test.png'))
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
})

function parseResponse(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]?.text ?? '{}')
}

describe('generate_image flow', () => {
  it('enhances the prompt, generates, saves, and returns a resource', async () => {
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_image', { prompt: 'a cat' })

    expect(result.isError).toBe(false)

    // Stage 1 enhancement ran, Stage 2 used the enhanced prompt.
    expect(mockGenerateText).toHaveBeenCalledTimes(1)
    expect(mockGenerateImage).toHaveBeenCalledTimes(1)
    expect(mockGenerateImage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ prompt: 'enhanced prompt' })
    )

    // Image bytes were saved.
    expect(mockSaveImage).toHaveBeenCalledTimes(1)
    expect(mockSaveImage.mock.calls[0]?.[0]).toBeInstanceOf(Buffer)

    const payload = parseResponse(result)
    expect(payload.type).toBe('resource')
    expect(payload.resource.uri).toContain('image-test.png')
    expect(payload.metadata.model).toBe('google/gemini-3.1-flash-image')
    expect(payload.metadata.provider).toBe('openrouter')
  })

  it('skips prompt enhancement when SKIP_PROMPT_ENHANCEMENT=true', async () => {
    process.env.SKIP_PROMPT_ENHANCEMENT = 'true'
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_image', { prompt: 'a cat' })

    expect(result.isError).toBe(false)
    expect(mockGenerateText).not.toHaveBeenCalled()
    expect(mockGenerateImage.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ prompt: 'a cat' })
    )
  })

  it('returns an error response when image generation fails', async () => {
    mockGenerateImage.mockResolvedValue(
      Err(new ImageAPIError('boom', { provider: 'openrouter', stage: 'image_generation' }))
    )
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_image', { prompt: 'a cat' })

    expect(result.isError).toBe(true)
    expect(mockSaveImage).not.toHaveBeenCalled()
    const payload = parseResponse(result)
    expect(payload.error.code).toBe('IMAGE_API_ERROR')
  })

  it('returns a config error when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_image', { prompt: 'a cat' })

    expect(result.isError).toBe(true)
    const payload = parseResponse(result)
    expect(payload.error.code).toBe('CONFIG_ERROR')
    expect(mockGenerateImage).not.toHaveBeenCalled()
  })

  it('attaches an inline image preview by default', async () => {
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_image', { prompt: 'a cat' })

    const image = result.content.find((c) => c.type === 'image')
    expect(image).toBeDefined()
    expect((image as { mimeType: string }).mimeType).toBe('image/jpeg')
    expect((image as { data: string }).data.length).toBeGreaterThan(0)
  })

  it('omits the inline preview when IMAGE_INLINE_PREVIEW=false', async () => {
    process.env.IMAGE_INLINE_PREVIEW = 'false'
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_image', { prompt: 'a cat' })

    expect(result.isError).toBe(false)
    expect(result.content.find((c) => c.type === 'image')).toBeUndefined()
  })

  it('returns real duration, decoded width/height, format and mapping report', async () => {
    mockGenerateImage.mockResolvedValue(
      Ok({
        imageData: realPng,
        metadata: {
          ...METADATA,
          requested: { aspectRatio: '16:9', imageSize: '4K' },
          delivered: { aspectRatio: '3:2', imageSize: null },
          warnings: ['aspectRatio 16:9 mapped to 3:2'],
        },
      })
    )
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_image', { prompt: 'a cat' })

    const { metadata } = parseResponse(result)
    expect(metadata.width).toBe(600)
    expect(metadata.height).toBe(400)
    expect(metadata.durationMs).toBe(4321)
    expect(metadata.processingTime).toBe(4321)
    expect(metadata.format).toBe('png')
    expect(metadata.requested).toEqual({ aspectRatio: '16:9', imageSize: '4K' })
    expect(metadata.delivered).toEqual({ aspectRatio: '3:2', imageSize: null })
    expect(metadata.warnings).toEqual(['aspectRatio 16:9 mapped to 3:2'])
  })

  it('still reports width/height when the inline preview is disabled', async () => {
    process.env.IMAGE_INLINE_PREVIEW = 'false'
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_image', { prompt: 'a cat' })

    const { metadata } = parseResponse(result)
    expect(metadata.width).toBe(600)
    expect(metadata.height).toBe(400)
    expect(result.content.find((c) => c.type === 'image')).toBeUndefined()
  })

  it('succeeds without width/height/preview when the bytes cannot be decoded', async () => {
    mockGenerateImage.mockResolvedValue(
      Ok({ imageData: Buffer.from('not an image'), metadata: METADATA })
    )
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_image', { prompt: 'a cat' })

    expect(result.isError).toBe(false)
    const { metadata } = parseResponse(result)
    expect(metadata).not.toHaveProperty('width')
    expect(metadata).not.toHaveProperty('height')
    expect(result.content.find((c) => c.type === 'image')).toBeUndefined()
  })

  describe('preset diagram and outputFormat', () => {
    it('skips enhancement, forces the quality tier and requests png + opaque background', async () => {
      const server = new MCPServerImpl()

      const result = await server.callTool('generate_image', {
        prompt: 'a flowchart',
        preset: 'diagram',
      })

      expect(result.isError).toBe(false)
      expect(mockGenerateText).not.toHaveBeenCalled()
      const call = mockGenerateImage.mock.calls[0]?.[0]
      expect(call).toEqual(
        expect.objectContaining({
          prompt: 'a flowchart',
          quality: 'quality',
          outputFormat: 'png',
          background: 'opaque',
        })
      )
      expect(call.outputFormatExplicit).not.toBe(true)
    })

    it('lets an explicit quality and outputFormat win and marks the format explicit', async () => {
      const server = new MCPServerImpl()

      await server.callTool('generate_image', {
        prompt: 'a flowchart',
        preset: 'diagram',
        quality: 'fast',
        outputFormat: 'jpeg',
      })

      expect(mockGenerateImage.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          quality: 'fast',
          outputFormat: 'jpeg',
          outputFormatExplicit: true,
          background: 'opaque',
        })
      )
    })

    it('passes a caller outputFormat without a preset and sends no background', async () => {
      const server = new MCPServerImpl()

      await server.callTool('generate_image', { prompt: 'a cat', outputFormat: 'webp' })

      const call = mockGenerateImage.mock.calls[0]?.[0]
      expect(call).toEqual(
        expect.objectContaining({ outputFormat: 'webp', outputFormatExplicit: true })
      )
      expect(call.background).toBeUndefined()
      expect(mockGenerateText).toHaveBeenCalledTimes(1)
    })

    it('rejects an unknown preset with INPUT_VALIDATION_ERROR', async () => {
      const server = new MCPServerImpl()

      const result = await server.callTool('generate_image', { prompt: 'a cat', preset: 'poster' })

      expect(result.isError).toBe(true)
      expect(parseResponse(result).error.code).toBe('INPUT_VALIDATION_ERROR')
      expect(mockGenerateImage).not.toHaveBeenCalled()
    })
  })
})
