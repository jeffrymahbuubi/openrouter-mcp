/**
 * Tests for the pure preset resolution (diagram preset).
 */

import { describe, expect, it } from 'vitest'
import { applyDiagramPreset } from '../generationPresets'

describe('applyDiagramPreset', () => {
  it('skips enhancement, defaults to the quality tier, png and an opaque background', () => {
    expect(applyDiagramPreset({ prompt: 'a flowchart' })).toEqual({
      skipEnhancement: true,
      quality: 'quality',
      outputFormat: 'png',
      background: 'opaque',
    })
  })

  it('lets an explicit caller quality win over the preset default', () => {
    expect(applyDiagramPreset({ prompt: 'x', quality: 'fast' }).quality).toBe('fast')
  })

  it('lets an explicit caller outputFormat win over the preset default', () => {
    expect(applyDiagramPreset({ prompt: 'x', outputFormat: 'jpeg' }).outputFormat).toBe('jpeg')
  })
})
