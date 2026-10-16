/**
 * Tests for OpenRouter audio configuration loading & validation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getConfig, selectMusicModel, validateConfig } from '../config'

const OPENROUTER_ENV_VARS = [
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_VOICE_MODEL',
  'OPENROUTER_MUSIC_MODEL',
  'OPENROUTER_MUSIC_MODEL_LONG',
  'OPENROUTER_APP_URL',
  'OPENROUTER_APP_TITLE',
  'AUDIO_OUTPUT_DIR',
  'OPENROUTER_VOICE_DEFAULT',
  'OPENROUTER_VOICE_ENDPOINT',
  'AUDIO_DEFAULT_FORMAT',
] as const

function baseConfig() {
  return {
    openrouterApiKey: 'sk-or-valid-key-12345',
    baseUrl: 'https://openrouter.ai/api/v1',
    voiceModel: 'openai/gpt-audio',
    musicModel: 'google/lyria-3-clip-preview',
    musicModelLong: 'google/lyria-3-pro-preview',
    audioOutputDir: './output',
    apiTimeout: 120000,
    voiceEndpoint: 'auto' as const,
    defaultVoice: 'alloy',
    defaultAudioFormat: 'wav' as const,
  }
}

describe('config', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of OPENROUTER_ENV_VARS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of OPENROUTER_ENV_VARS) {
      if (saved[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = saved[key]
      }
    }
  })

  describe('validateConfig', () => {
    it('returns an error when OPENROUTER_API_KEY is missing', () => {
      const result = validateConfig({ ...baseConfig(), openrouterApiKey: '' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain('OPENROUTER_API_KEY')
        expect(result.error.suggestion).toContain('OPENROUTER_API_KEY')
      }
    })

    it('returns an error when OPENROUTER_API_KEY is too short', () => {
      const result = validateConfig({ ...baseConfig(), openrouterApiKey: 'short' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain('at least 10 characters')
      }
    })

    it('returns an error on an empty or malformed defaultVoice', () => {
      for (const defaultVoice of ['', '   ', 'a'.repeat(129), 'geo\u0000rge']) {
        const result = validateConfig({ ...baseConfig(), defaultVoice })
        expect(result.success).toBe(false)
        if (!result.success) {
          expect(result.error.code).toBe('CONFIG_ERROR')
          expect(result.error.message).toContain('OPENROUTER_VOICE_DEFAULT')
        }
      }
    })

    it('accepts provider-specific defaultVoice ids', () => {
      for (const defaultVoice of ['george', 'en-US-Harper:MAI-Voice-2.1']) {
        expect(validateConfig({ ...baseConfig(), defaultVoice }).success).toBe(true)
      }
    })

    it('rejects an unknown voiceEndpoint naming the three options', () => {
      const result = validateConfig({
        ...baseConfig(),
        voiceEndpoint: 'foo' as unknown as ReturnType<typeof baseConfig>['voiceEndpoint'],
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('CONFIG_ERROR')
        expect(result.error.message).toContain('OPENROUTER_VOICE_ENDPOINT')
        expect(result.error.message).toContain('auto')
        expect(result.error.message).toContain('chat')
        expect(result.error.message).toContain('speech')
      }
    })

    it('returns an error on an invalid defaultAudioFormat', () => {
      const result = validateConfig({
        ...baseConfig(),
        defaultAudioFormat: 'ogg' as unknown as ReturnType<typeof baseConfig>['defaultAudioFormat'],
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain('AUDIO_DEFAULT_FORMAT')
      }
    })

    it('accepts a valid configuration', () => {
      const result = validateConfig(baseConfig())
      expect(result.success).toBe(true)
    })
  })

  describe('getConfig', () => {
    it('fails when OPENROUTER_API_KEY is not set', () => {
      const result = getConfig()
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain('OPENROUTER_API_KEY')
      }
    })

    it('applies model + base-url defaults when only the key is set', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-valid-key-12345'
      const result = getConfig()
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.baseUrl).toBe('https://openrouter.ai/api/v1')
        expect(result.data.voiceModel).toBe('openai/gpt-audio')
        expect(result.data.musicModel).toBe('google/lyria-3-clip-preview')
        expect(result.data.defaultVoice).toBe('alloy')
        expect(result.data.voiceEndpoint).toBe('auto')
        expect(result.data.defaultAudioFormat).toBe('wav')
        expect(result.data.apiTimeout).toBe(120000)
      }
    })

    it('accepts a provider voice id for OPENROUTER_VOICE_DEFAULT', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-valid-key-12345'
      process.env.OPENROUTER_VOICE_DEFAULT = 'george'
      const result = getConfig()
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.defaultVoice).toBe('george')
      }
    })

    it('reads OPENROUTER_VOICE_ENDPOINT (chat | speech) and rejects other values', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-valid-key-12345'
      for (const value of ['chat', 'speech', 'auto'] as const) {
        process.env.OPENROUTER_VOICE_ENDPOINT = value
        const result = getConfig()
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.voiceEndpoint).toBe(value)
        }
      }
      process.env.OPENROUTER_VOICE_ENDPOINT = 'foo'
      const bad = getConfig()
      expect(bad.success).toBe(false)
      if (!bad.success) {
        expect(bad.error.code).toBe('CONFIG_ERROR')
      }
    })

    it('falls back OPENROUTER_MUSIC_MODEL_LONG to OPENROUTER_MUSIC_MODEL when unset', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-valid-key-12345'
      process.env.OPENROUTER_MUSIC_MODEL = 'google/lyria-3-clip-preview'
      const result = getConfig()
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.musicModel).toBe('google/lyria-3-clip-preview')
        expect(result.data.musicModelLong).toBe('google/lyria-3-clip-preview')
      }
    })

    it('reads a distinct long-track model and optional attribution headers', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-valid-key-12345'
      process.env.OPENROUTER_MUSIC_MODEL_LONG = 'google/lyria-3-pro-preview'
      process.env.OPENROUTER_APP_URL = 'https://example.com'
      process.env.OPENROUTER_APP_TITLE = 'My App'
      const result = getConfig()
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.musicModelLong).toBe('google/lyria-3-pro-preview')
        expect(result.data.appUrl).toBe('https://example.com')
        expect(result.data.appTitle).toBe('My App')
      }
    })

    it('honours OPENROUTER_VOICE_DEFAULT and AUDIO_DEFAULT_FORMAT overrides', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-valid-key-12345'
      process.env.OPENROUTER_VOICE_DEFAULT = 'nova'
      process.env.AUDIO_DEFAULT_FORMAT = 'mp3'
      const result = getConfig()
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.defaultVoice).toBe('nova')
        expect(result.data.defaultAudioFormat).toBe('mp3')
      }
    })
  })

  describe('selectMusicModel', () => {
    it('returns musicModel for "clip"', () => {
      const config = baseConfig()
      expect(selectMusicModel(config, 'clip')).toBe(config.musicModel)
    })

    it('returns musicModelLong for "long"', () => {
      const config = baseConfig()
      expect(selectMusicModel(config, 'long')).toBe(config.musicModelLong)
    })
  })
})
