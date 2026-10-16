/**
 * Tests for OpenRouter configuration loading & validation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getConfig, validateConfig } from '../config'

const OPENROUTER_ENV_VARS = [
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_TEXT_MODEL',
  'OPENROUTER_IMAGE_MODEL',
  'OPENROUTER_IMAGE_MODEL_HQ',
  'OPENROUTER_APP_URL',
  'OPENROUTER_APP_TITLE',
  'OPENROUTER_IMAGE_TIMEOUT_MS',
  'IMAGE_OUTPUT_DIR',
  'IMAGE_QUALITY',
  'SKIP_PROMPT_ENHANCEMENT',
  'IMAGE_INLINE_PREVIEW',
] as const

function baseConfig() {
  return {
    openrouterApiKey: 'sk-or-valid-key-12345',
    baseUrl: 'https://openrouter.ai/api/v1',
    textModel: 'google/gemini-3.5-flash',
    imageModel: 'google/gemini-3.1-flash-image',
    imageModelHq: 'google/gemini-3-pro-image',
    imageOutputDir: './output',
    apiTimeout: 30000,
    imageApiTimeout: 180000,
    skipPromptEnhancement: false,
    imageQuality: 'fast' as const,
    inlinePreview: true,
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

    it('returns an error on an invalid IMAGE_QUALITY', () => {
      const result = validateConfig({
        ...baseConfig(),
        imageQuality: 'ultra' as unknown as ReturnType<typeof baseConfig>['imageQuality'],
      })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain('IMAGE_QUALITY')
      }
    })

    it('accepts a valid configuration', () => {
      const result = validateConfig(baseConfig())
      expect(result.success).toBe(true)
    })

    it('rejects a non-positive imageApiTimeout and accepts 1', () => {
      const bad = validateConfig({ ...baseConfig(), imageApiTimeout: 0 })
      expect(bad.success).toBe(false)
      if (!bad.success) {
        expect(bad.error.message).toContain('OPENROUTER_IMAGE_TIMEOUT_MS')
      }
      expect(validateConfig({ ...baseConfig(), imageApiTimeout: 1 }).success).toBe(true)
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
        expect(result.data.textModel).toBe('google/gemini-3.5-flash')
        expect(result.data.imageModel).toBe('google/gemini-3.1-flash-image')
        expect(result.data.imageQuality).toBe('fast')
        expect(result.data.skipPromptEnhancement).toBe(false)
      }
    })

    it('falls back OPENROUTER_IMAGE_MODEL_HQ to OPENROUTER_IMAGE_MODEL when unset', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-valid-key-12345'
      process.env.OPENROUTER_IMAGE_MODEL = 'google/gemini-2.5-flash-image'
      const result = getConfig()
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.imageModel).toBe('google/gemini-2.5-flash-image')
        expect(result.data.imageModelHq).toBe('google/gemini-2.5-flash-image')
      }
    })

    it('reads a distinct HQ model and optional attribution headers', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-valid-key-12345'
      process.env.OPENROUTER_IMAGE_MODEL_HQ = 'google/gemini-3-pro-image'
      process.env.OPENROUTER_APP_URL = 'https://example.com'
      process.env.OPENROUTER_APP_TITLE = 'My App'
      const result = getConfig()
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.imageModelHq).toBe('google/gemini-3-pro-image')
        expect(result.data.appUrl).toBe('https://example.com')
        expect(result.data.appTitle).toBe('My App')
      }
    })

    it('honours SKIP_PROMPT_ENHANCEMENT and IMAGE_QUALITY overrides', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-valid-key-12345'
      process.env.SKIP_PROMPT_ENHANCEMENT = 'true'
      process.env.IMAGE_QUALITY = 'quality'
      const result = getConfig()
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skipPromptEnhancement).toBe(true)
        expect(result.data.imageQuality).toBe('quality')
      }
    })

    it('defaults imageApiTimeout to 180000 and leaves apiTimeout at 30000', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-valid-key-12345'
      const result = getConfig()
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.imageApiTimeout).toBe(180000)
        expect(result.data.apiTimeout).toBe(30000)
      }
    })

    it('reads OPENROUTER_IMAGE_TIMEOUT_MS without touching apiTimeout', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-valid-key-12345'
      process.env.OPENROUTER_IMAGE_TIMEOUT_MS = ' 90000 '
      const result = getConfig()
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.imageApiTimeout).toBe(90000)
        expect(result.data.apiTimeout).toBe(30000)
      }
    })

    it.each([
      'abc',
      '0',
      '-5',
      '12.5',
    ])('rejects OPENROUTER_IMAGE_TIMEOUT_MS=%s with a ConfigError naming the variable', (value) => {
      process.env.OPENROUTER_API_KEY = 'sk-or-valid-key-12345'
      process.env.OPENROUTER_IMAGE_TIMEOUT_MS = value
      const result = getConfig()
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toBe('CONFIG_ERROR')
        expect(result.error.message).toContain('OPENROUTER_IMAGE_TIMEOUT_MS')
        expect(result.error.suggestion).toContain('180000')
      }
    })

    it('enables inline preview by default and disables it only on explicit false', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-valid-key-12345'
      const on = getConfig()
      expect(on.success && on.data.inlinePreview).toBe(true)

      process.env.IMAGE_INLINE_PREVIEW = 'false'
      const off = getConfig()
      expect(off.success && off.data.inlinePreview).toBe(false)
    })
  })
})
