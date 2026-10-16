/**
 * Tests for the thumbnail preview generator (inline image preview for MCP clients).
 */

import { Jimp } from 'jimp'
import { describe, expect, it } from 'vitest'
import { analyzeImage, THUMBNAIL_MAX_DIM } from '../thumbnail'

async function makePng(width: number, height: number): Promise<Buffer> {
  const image = new Jimp({ width, height, color: 0x3366ffff })
  return image.getBuffer('image/png')
}

describe('analyzeImage', () => {
  it('produces a base64 JPEG preview smaller than the source', async () => {
    const source = await makePng(1200, 800)

    const result = await analyzeImage(source, { withPreview: true })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.preview?.mimeType).toBe('image/jpeg')
      const bytes = Buffer.from(result.data.preview?.data ?? '', 'base64')
      // JPEG magic bytes
      expect(bytes[0]).toBe(0xff)
      expect(bytes[1]).toBe(0xd8)
      // Preview must stay small enough for an inline MCP response (well under limits).
      expect(bytes.length).toBeLessThan(200_000)
    }
  })

  it('downscales the longest side to at most THUMBNAIL_MAX_DIM', async () => {
    const source = await makePng(2000, 1000)

    const result = await analyzeImage(source, { withPreview: true })

    expect(result.success).toBe(true)
    if (result.success) {
      const image = await Jimp.fromBuffer(Buffer.from(result.data.preview?.data ?? '', 'base64'))
      expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(THUMBNAIL_MAX_DIM)
    }
  })

  it('does not upscale images already smaller than the max dimension', async () => {
    const source = await makePng(200, 120)

    const result = await analyzeImage(source, { withPreview: true })

    expect(result.success).toBe(true)
    if (result.success) {
      const image = await Jimp.fromBuffer(Buffer.from(result.data.preview?.data ?? '', 'base64'))
      expect(image.width).toBeLessThanOrEqual(200)
      expect(image.height).toBeLessThanOrEqual(120)
    }
  })

  it('returns an error for data that is not a valid image', async () => {
    const result = await analyzeImage(Buffer.from('this is not an image'), { withPreview: true })

    expect(result.success).toBe(false)
  })

  it('reports the source width and height from the same decode as the preview', async () => {
    const source = await makePng(2000, 1000)

    const result = await analyzeImage(source, { withPreview: true })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.width).toBe(2000)
      expect(result.data.height).toBe(1000)
    }
  })

  it('returns dimensions but no preview when withPreview is false', async () => {
    const source = await makePng(600, 400)

    const result = await analyzeImage(source, { withPreview: false })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.width).toBe(600)
      expect(result.data.height).toBe(400)
      expect(result.data.preview).toBeUndefined()
    }
  })
})
