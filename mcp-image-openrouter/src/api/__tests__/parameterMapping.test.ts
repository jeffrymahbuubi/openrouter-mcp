/**
 * Tests for the pure request-parameter mapping: native / nearest / fold / drop
 * per model capabilities, with requested-vs-delivered reporting and warnings.
 */

import { describe, expect, it } from 'vitest'
import type { ModelCapabilities } from '../modelCapabilities'
import { mapParameters } from '../parameterMapping'

const GPT: ModelCapabilities = {
  aspectRatios: ['1:1', '3:2', '2:3', 'auto'],
  resolutions: null,
  outputFormats: null,
  quality: true,
  background: true,
}

const GEMINI_PRO: ModelCapabilities = {
  aspectRatios: ['1:1', '3:2', '2:3', '16:9', '9:16'],
  resolutions: ['1K', '2K', '4K'],
  outputFormats: null,
  quality: false,
  background: false,
}

const GEMINI_LITE: ModelCapabilities = { ...GEMINI_PRO, resolutions: ['1K'] }

const UNKNOWN: ModelCapabilities = {
  aspectRatios: null,
  resolutions: null,
  outputFormats: null,
  quality: false,
  background: false,
}

const POINTER = 'Call get_model_guide to choose a model that supports this.'

describe('mapParameters — aspect ratio', () => {
  it.each([
    ['16:9', '3:2'],
    ['21:9', '3:2'],
    ['4:3', '3:2'],
    ['5:4', '3:2'],
    ['9:16', '2:3'],
    ['3:4', '2:3'],
    ['4:5', '2:3'],
    ['8:1', '3:2'],
    ['1:8', '2:3'],
  ])('maps %s to the nearest native %s on a GPT-style aspect list', (asked, sent) => {
    const mapped = mapParameters({ prompt: 'p', aspectRatio: asked as '16:9' }, GPT)

    expect(mapped.aspect_ratio).toBe(sent)
    expect(mapped.requested.aspectRatio).toBe(asked)
    expect(mapped.delivered.aspectRatio).toBe(sent)
    expect(mapped.warnings).toHaveLength(1)
    expect(mapped.warnings[0]).toContain(asked)
    expect(mapped.warnings[0]).toContain(sent)
    expect(mapped.warnings[0]?.endsWith(POINTER)).toBe(true)
  })

  it('sends 1:1 natively with no warning', () => {
    const mapped = mapParameters({ prompt: 'p', aspectRatio: '1:1' }, GPT)

    expect(mapped.aspect_ratio).toBe('1:1')
    expect(mapped.delivered.aspectRatio).toBe('1:1')
    expect(mapped.warnings).toEqual([])
  })

  it('ignores non-ratio tokens such as auto when computing the nearest aspect', () => {
    const mapped = mapParameters({ prompt: 'p', aspectRatio: '16:9' }, GPT)

    expect(mapped.aspect_ratio).toBe('3:2')
  })

  it('folds the aspect into the prompt when the model exposes no aspect parameter', () => {
    const mapped = mapParameters({ prompt: 'p', aspectRatio: '16:9' }, UNKNOWN)

    expect(mapped.aspect_ratio).toBeUndefined()
    expect(mapped.promptSuffix).toContain('16:9')
    expect(mapped.delivered.aspectRatio).toBeNull()
    expect(mapped.requested.aspectRatio).toBe('16:9')
    expect(mapped.warnings[0]?.toLowerCase()).toContain('folded')
    expect(mapped.warnings[0]?.endsWith(POINTER)).toBe(true)
  })

  it('reports null/null and no warning when no aspect was requested', () => {
    const mapped = mapParameters({ prompt: 'p' }, GPT)

    expect(mapped.requested).toEqual({ aspectRatio: null, imageSize: null })
    expect(mapped.delivered).toEqual({ aspectRatio: null, imageSize: null })
    expect(mapped.warnings).toEqual([])
    expect(mapped.promptSuffix).toBe('')
  })
})

describe('mapParameters — image size', () => {
  it('drops imageSize with a warning when the model has no resolution parameter', () => {
    const mapped = mapParameters({ prompt: 'p', imageSize: '4K' }, GPT)

    expect(mapped.resolution).toBeUndefined()
    expect(mapped.promptSuffix).toBe('') // never folded into the prompt
    expect(mapped.requested.imageSize).toBe('4K')
    expect(mapped.delivered.imageSize).toBeNull()
    expect(mapped.warnings[0]).toContain('4K')
    expect(mapped.warnings[0]?.toLowerCase()).toContain('no resolution parameter')
    expect(mapped.warnings[0]?.endsWith(POINTER)).toBe(true)
  })

  it('maps 4K to the nearest listed resolution (1K) with a warning', () => {
    const mapped = mapParameters({ prompt: 'p', imageSize: '4K' }, GEMINI_LITE)

    expect(mapped.resolution).toBe('1K')
    expect(mapped.delivered.imageSize).toBe('1K')
    expect(mapped.warnings[0]).toContain('4K')
    expect(mapped.warnings[0]).toContain('1K')
  })

  it('sends a listed resolution natively with no warning', () => {
    const mapped = mapParameters({ prompt: 'p', imageSize: '4K' }, GEMINI_PRO)

    expect(mapped.resolution).toBe('4K')
    expect(mapped.delivered.imageSize).toBe('4K')
    expect(mapped.warnings).toEqual([])
  })

  it('compares pixel classes, not list position (2K asked, list 4K,1K -> 4K)', () => {
    const caps = { ...GEMINI_PRO, resolutions: ['4K', '1K'] }

    const mapped = mapParameters({ prompt: 'p', imageSize: '2K' }, caps)

    expect(mapped.resolution).toBe('4K')
  })
})

describe('mapParameters — quality gate', () => {
  it('sends quality high on the quality tier when the model lists quality', () => {
    expect(mapParameters({ prompt: 'p', quality: 'quality' }, GPT).quality).toBe('high')
  })

  it('sends no quality on fast or balanced tiers', () => {
    expect(mapParameters({ prompt: 'p', quality: 'fast' }, GPT).quality).toBeUndefined()
    expect(mapParameters({ prompt: 'p', quality: 'balanced' }, GPT).quality).toBeUndefined()
    expect(mapParameters({ prompt: 'p' }, GPT).quality).toBeUndefined()
  })

  it('sends nothing and warns nothing when the model does not list quality', () => {
    const mapped = mapParameters({ prompt: 'p', quality: 'quality' }, GEMINI_PRO)

    expect(mapped.quality).toBeUndefined()
    expect(mapped.warnings).toEqual([])
  })

  it('lets the test-only openrouterQuality override the tier-derived high', () => {
    const mapped = mapParameters(
      { prompt: 'p', quality: 'quality', openrouterQuality: 'medium' },
      GPT
    )

    expect(mapped.quality).toBe('medium')
  })
})

describe('mapParameters — output format', () => {
  it('warns and omits output_format for an explicit request the model cannot take', () => {
    const mapped = mapParameters(
      { prompt: 'p', outputFormat: 'png', outputFormatExplicit: true },
      GPT
    )

    expect(mapped.output_format).toBeUndefined()
    expect(mapped.warnings[0]).toContain('png')
    expect(mapped.warnings[0]?.toLowerCase()).toContain('model decides')
    expect(mapped.warnings[0]?.endsWith(POINTER)).toBe(true)
  })

  it('drops a preset-default format silently', () => {
    const mapped = mapParameters({ prompt: 'p', outputFormat: 'png' }, GPT)

    expect(mapped.output_format).toBeUndefined()
    expect(mapped.warnings).toEqual([])
  })

  it('sends output_format when the accepted list contains it', () => {
    const caps = { ...GPT, outputFormats: ['png', 'jpeg', 'webp'] }

    const mapped = mapParameters(
      { prompt: 'p', outputFormat: 'png', outputFormatExplicit: true },
      caps
    )

    expect(mapped.output_format).toBe('png')
    expect(mapped.warnings).toEqual([])
  })

  it('warns when the requested format is not in the accepted list', () => {
    const caps = { ...GPT, outputFormats: ['png'] }

    const mapped = mapParameters(
      { prompt: 'p', outputFormat: 'jpeg', outputFormatExplicit: true },
      caps
    )

    expect(mapped.output_format).toBeUndefined()
    expect(mapped.warnings[0]).toContain('jpeg')
  })
})

describe('mapParameters — background', () => {
  it('sends background natively when the model supports it', () => {
    const mapped = mapParameters({ prompt: 'p', background: 'opaque' }, GPT)

    expect(mapped.background).toBe('opaque')
    expect(mapped.promptSuffix).toBe('')
    expect(mapped.warnings).toEqual([])
  })

  it('drops background, adds a white-background prompt hint and warns when unsupported', () => {
    const mapped = mapParameters({ prompt: 'p', background: 'opaque' }, UNKNOWN)

    expect(mapped.background).toBeUndefined()
    expect(mapped.promptSuffix.toLowerCase()).toContain('white background')
    expect(mapped.warnings[0]?.toLowerCase()).toContain('background')
    expect(mapped.warnings[0]?.endsWith(POINTER)).toBe(true)
  })
})

describe('mapParameters — all native', () => {
  it('produces no warnings for a fully supported Gemini request', () => {
    const mapped = mapParameters({ prompt: 'p', aspectRatio: '16:9', imageSize: '2K' }, GEMINI_PRO)

    expect(mapped.aspect_ratio).toBe('16:9')
    expect(mapped.resolution).toBe('2K')
    expect(mapped.warnings).toEqual([])
    expect(mapped.promptSuffix).toBe('')
  })
})
