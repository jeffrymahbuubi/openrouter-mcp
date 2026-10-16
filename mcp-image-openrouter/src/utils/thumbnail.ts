/**
 * Image analysis: decoded dimensions plus an optional thumbnail preview, both
 * from a single decode.
 *
 * The preview is a small, downscaled JPEG (base64) so MCP clients (e.g. Claude
 * Desktop) can render an inline preview, while the full-resolution image is
 * still written to disk. Kept well under MCP response size limits — the full
 * image is never returned inline.
 *
 * Uses `jimp` (pure JS, no native binaries) so it works everywhere the package
 * is installed via npx.
 */

import { Jimp } from 'jimp'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'

/** Longest-side cap for the preview, in pixels. */
export const THUMBNAIL_MAX_DIM = 512
/** JPEG quality for the preview (0–100). Kept modest to bound response size. */
const THUMBNAIL_JPEG_QUALITY = 60

/**
 * A base64-encoded inline image preview (no `data:` prefix).
 */
interface ThumbnailPreview {
  data: string
  mimeType: string
}

/**
 * Decoded source dimensions plus the optional inline preview.
 */
export interface ImageAnalysis {
  width: number
  height: number
  preview?: ThumbnailPreview
}

/**
 * Decode raw image bytes once and report their pixel size, plus a downscaled
 * JPEG preview when `withPreview` is set.
 * Best-effort: returns an error Result on any decode/encode failure so callers
 * can omit the size and preview without failing the whole request.
 */
export async function analyzeImage(
  imageData: Buffer,
  options: { withPreview: boolean }
): Promise<Result<ImageAnalysis, Error>> {
  try {
    const image = await Jimp.fromBuffer(imageData)
    const { width, height } = image
    if (!options.withPreview) {
      return Ok({ width, height })
    }
    // Only downscale — `scaleToFit` would otherwise upscale images smaller than the box.
    if (Math.max(width, height) > THUMBNAIL_MAX_DIM) {
      image.scaleToFit({ w: THUMBNAIL_MAX_DIM, h: THUMBNAIL_MAX_DIM })
    }
    const jpeg = await image.getBuffer('image/jpeg', { quality: THUMBNAIL_JPEG_QUALITY })
    return Ok({ width, height, preview: { data: jpeg.toString('base64'), mimeType: 'image/jpeg' } })
  } catch (error) {
    return Err(error instanceof Error ? error : new Error('Image analysis failed'))
  }
}
