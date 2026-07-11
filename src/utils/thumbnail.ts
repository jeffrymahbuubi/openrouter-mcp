/**
 * Thumbnail preview generator.
 *
 * Produces a small, downscaled JPEG (base64) from a generated image so MCP
 * clients (e.g. Claude Desktop) can render an inline preview, while the
 * full-resolution image is still written to disk. Kept well under MCP response
 * size limits — the full image is never returned inline.
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
export interface ThumbnailPreview {
  data: string
  mimeType: string
}

/**
 * Generate a downscaled JPEG preview from raw image bytes.
 * Best-effort: returns an error Result on any decode/encode failure so callers
 * can omit the preview without failing the whole request.
 */
export async function generateThumbnail(
  imageData: Buffer
): Promise<Result<ThumbnailPreview, Error>> {
  try {
    const image = await Jimp.fromBuffer(imageData)
    // Only downscale — `scaleToFit` would otherwise upscale images smaller than the box.
    if (Math.max(image.width, image.height) > THUMBNAIL_MAX_DIM) {
      image.scaleToFit({ w: THUMBNAIL_MAX_DIM, h: THUMBNAIL_MAX_DIM })
    }
    const jpeg = await image.getBuffer('image/jpeg', { quality: THUMBNAIL_JPEG_QUALITY })
    return Ok({ data: jpeg.toString('base64'), mimeType: 'image/jpeg' })
  } catch (error) {
    return Err(error instanceof Error ? error : new Error('Thumbnail generation failed'))
  }
}
