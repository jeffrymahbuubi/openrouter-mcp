/**
 * Tests for the bundled image-model guide content.
 */

import { describe, expect, it } from 'vitest'
import { MODEL_GUIDE_MARKDOWN, MODEL_GUIDE_SUMMARY } from '../modelGuide'

describe('modelGuide', () => {
  it('is dated 2026-10-16 so readers can judge staleness', () => {
    expect(MODEL_GUIDE_MARKDOWN).toContain('2026-10-16')
  })

  it('recommends the top text-exact diagram model and has a diagram prompting-tips heading', () => {
    expect(MODEL_GUIDE_MARKDOWN).toContain('openai/gpt-image-2.5-sunburst')
    expect(MODEL_GUIDE_MARKDOWN).toMatch(/^### Diagrams and flowcharts/m)
  })

  it('documents how this server maps parameters and the diagram preset', () => {
    expect(MODEL_GUIDE_MARKDOWN).toContain('preset: "diagram"')
    expect(MODEL_GUIDE_MARKDOWN).toContain('OPENROUTER_IMAGE_TIMEOUT_MS')
  })

  it('has a short summary that names picks and points at the tool', () => {
    expect(MODEL_GUIDE_SUMMARY).toContain('get_model_guide')
    expect(MODEL_GUIDE_SUMMARY).toContain('openai/gpt-image-2.5-sunburst')
    expect(MODEL_GUIDE_SUMMARY.length).toBeLessThan(900)
  })
})
