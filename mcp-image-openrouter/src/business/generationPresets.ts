/**
 * Named generation presets, resolved server-side as pure functions.
 *
 * The diagram preset has no capability input: it only states what the caller
 * wants. The image client then gates each field by what the model accepts
 * (and adds the white-background prompt hint when `background` is unsupported).
 */

import type { GenerateImageParams, ImageQuality, OutputFormat } from '../types/mcp.js'

export interface DiagramPreset {
  skipEnhancement: true
  quality: ImageQuality
  outputFormat: OutputFormat
  background: 'opaque'
}

/**
 * Text-exact figures: no prompt rewriting, the quality tier, a PNG and an
 * opaque background. An explicit caller `quality` / `outputFormat` wins.
 */
export function applyDiagramPreset(
  params: Pick<GenerateImageParams, 'quality' | 'outputFormat'>
): DiagramPreset {
  return {
    skipEnhancement: true,
    quality: params.quality ?? 'quality',
    outputFormat: params.outputFormat ?? 'png',
    background: 'opaque',
  }
}
