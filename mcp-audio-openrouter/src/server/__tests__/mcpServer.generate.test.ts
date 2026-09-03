/**
 * Integration tests for the full generate_voice / generate_music flows
 * through MCPServerImpl.
 *
 * The OpenRouter audio client factory and the file manager are mocked so the
 * test exercises the real wiring (config → client → generation → save →
 * response) without network or disk I/O.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Err, Ok } from '../../types/result'
import { AudioAPIError } from '../../utils/errors'

const { mockGenerateVoice, mockGenerateMusic, mockSaveAudio, mockGenerateFileName } = vi.hoisted(
  () => ({
    mockGenerateVoice: vi.fn(),
    mockGenerateMusic: vi.fn(),
    mockSaveAudio: vi.fn(),
    mockGenerateFileName: vi.fn(() => 'voice-test.wav'),
  })
)

vi.mock('../../api/openrouterAudioClient', () => ({
  createOpenRouterAudioClient: vi.fn(() => ({
    success: true,
    data: { generateVoice: mockGenerateVoice, generateMusic: mockGenerateMusic },
  })),
}))

vi.mock('../../business/fileManager', () => ({
  createFileManager: vi.fn(() => ({
    saveAudio: mockSaveAudio,
    ensureDirectoryExists: vi.fn(() => ({ success: true, data: undefined })),
    generateFileName: mockGenerateFileName,
  })),
}))

import { MCPServerImpl } from '../mcpServer'

const VOICE_METADATA = {
  model: 'openai/gpt-audio',
  provider: 'openrouter' as const,
  prompt: 'Say hello',
  mimeType: 'audio/wav',
  timestamp: new Date('2026-09-01T00:00:00.000Z'),
  voice: 'alloy' as const,
  transcript: 'Hello there',
}

const MUSIC_METADATA = {
  model: 'google/lyria-3-clip-preview',
  provider: 'openrouter' as const,
  prompt: 'lofi chiptune',
  mimeType: 'audio/wav',
  timestamp: new Date('2026-09-01T00:00:00.000Z'),
  length: 'clip' as const,
}

const ENV_KEYS = ['OPENROUTER_API_KEY', 'AUDIO_OUTPUT_DIR'] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  process.env.OPENROUTER_API_KEY = 'sk-or-test-key-12345'

  vi.clearAllMocks()
  mockGenerateFileName.mockReturnValue('voice-test.wav')
  mockGenerateVoice.mockResolvedValue(
    Ok({ audioData: Buffer.from('fake-audio'), metadata: VOICE_METADATA })
  )
  mockGenerateMusic.mockResolvedValue(
    Ok({ audioData: Buffer.from('fake-audio'), metadata: MUSIC_METADATA })
  )
  mockSaveAudio.mockResolvedValue(Ok('/abs/output/voice-test.wav'))
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

describe('generate_voice flow', () => {
  it('generates, saves, and returns a resource with transcript metadata', async () => {
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_voice', { prompt: 'Say hello' })

    expect(result.isError).toBe(false)
    expect(mockGenerateVoice).toHaveBeenCalledTimes(1)
    expect(mockGenerateVoice.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ prompt: 'Say hello', voice: 'alloy', format: 'wav' })
    )
    expect(mockSaveAudio).toHaveBeenCalledTimes(1)
    expect(mockSaveAudio.mock.calls[0]?.[0]).toBeInstanceOf(Buffer)

    const payload = parseResponse(result)
    expect(payload.type).toBe('resource')
    expect(payload.resource.uri).toContain('voice-test.wav')
    expect(payload.metadata.model).toBe('openai/gpt-audio')
    expect(payload.metadata.transcript).toBe('Hello there')
  })

  it('honors a custom voice and format', async () => {
    const server = new MCPServerImpl()

    await server.callTool('generate_voice', { prompt: 'Say hello', voice: 'nova', format: 'mp3' })

    expect(mockGenerateVoice.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ voice: 'nova', format: 'mp3' })
    )
  })

  it('returns an error response when voice generation fails', async () => {
    mockGenerateVoice.mockResolvedValue(
      Err(new AudioAPIError('boom', { provider: 'openrouter', stage: 'audio_generation' }))
    )
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_voice', { prompt: 'Say hello' })

    expect(result.isError).toBe(true)
    expect(mockSaveAudio).not.toHaveBeenCalled()
    const payload = parseResponse(result)
    expect(payload.error.code).toBe('AUDIO_API_ERROR')
  })

  it('returns a config error when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_voice', { prompt: 'Say hello' })

    expect(result.isError).toBe(true)
    const payload = parseResponse(result)
    expect(payload.error.code).toBe('CONFIG_ERROR')
    expect(mockGenerateVoice).not.toHaveBeenCalled()
  })

  it('returns a validation error for an empty prompt', async () => {
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_voice', { prompt: '' })

    expect(result.isError).toBe(true)
    const payload = parseResponse(result)
    expect(payload.error.code).toBe('INPUT_VALIDATION_ERROR')
    expect(mockGenerateVoice).not.toHaveBeenCalled()
  })

  it('never inlines audio bytes in the response content', async () => {
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_voice', { prompt: 'Say hello' })

    expect(result.content).toHaveLength(1)
    expect(result.content[0]?.type).toBe('text')
  })
})

describe('generate_music flow', () => {
  it('generates, saves, and returns a resource with length metadata', async () => {
    mockGenerateFileName.mockReturnValue('music-test.wav')
    mockSaveAudio.mockResolvedValue(Ok('/abs/output/music-test.wav'))
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_music', { prompt: 'lofi chiptune' })

    expect(result.isError).toBe(false)
    expect(mockGenerateMusic).toHaveBeenCalledTimes(1)
    expect(mockGenerateMusic.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ prompt: 'lofi chiptune', length: 'clip', format: 'wav' })
    )

    const payload = parseResponse(result)
    expect(payload.type).toBe('resource')
    expect(payload.resource.uri).toContain('music-test.wav')
    expect(payload.metadata.length).toBe('clip')
  })

  it('defaults length to "clip" when unspecified and honors an explicit "long"', async () => {
    const server = new MCPServerImpl()

    await server.callTool('generate_music', { prompt: 'epic orchestral', length: 'long' })

    expect(mockGenerateMusic.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ length: 'long' })
    )
  })

  it('returns an error response when music generation fails', async () => {
    mockGenerateMusic.mockResolvedValue(
      Err(new AudioAPIError('boom', { provider: 'openrouter', stage: 'audio_generation' }))
    )
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_music', { prompt: 'lofi chiptune' })

    expect(result.isError).toBe(true)
    expect(mockSaveAudio).not.toHaveBeenCalled()
  })

  it('returns a config error when OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY
    const server = new MCPServerImpl()

    const result = await server.callTool('generate_music', { prompt: 'lofi chiptune' })

    expect(result.isError).toBe(true)
    const payload = parseResponse(result)
    expect(payload.error.code).toBe('CONFIG_ERROR')
    expect(mockGenerateMusic).not.toHaveBeenCalled()
  })
})
