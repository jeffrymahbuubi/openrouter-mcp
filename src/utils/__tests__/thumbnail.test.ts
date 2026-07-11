/**
 * Tests for the thumbnail preview generator (inline image preview for MCP clients).
 */

import { Jimp } from 'jimp'
import { describe, expect, it } from 'vitest'
import { generateThumbnail, THUMBNAIL_MAX_DIM } from '../thumbnail'

async function makePng(width: number, height: number): Promise<Buffer> {
  const image = new Jimp({ width, height, color: 0x3366ffff })
  return image.getBuffer('image/png')
}

describe('generateThumbnail', () => {
  it('produces a base64 JPEG preview smaller than the source', async () => {
    const source = await makePng(1200, 800)

    const result = await generateThumbnail(source)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mimeType).toBe('image/jpeg')
      const bytes = Buffer.from(result.data.data, 'base64')
      // JPEG magic bytes
      expect(bytes[0]).toBe(0xff)
      expect(bytes[1]).toBe(0xd8)
      // Preview must stay small enough for an inline MCP response (well under limits).
      expect(bytes.length).toBeLessThan(200_000)
    }
  })

  it('downscales the longest side to at most THUMBNAIL_MAX_DIM', async () => {
    const source = await makePng(2000, 1000)

    const result = await generateThumbnail(source)

    expect(result.success).toBe(true)
    if (result.success) {
      const image = await Jimp.fromBuffer(Buffer.from(result.data.data, 'base64'))
      expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(THUMBNAIL_MAX_DIM)
    }
  })

  it('does not upscale images already smaller than the max dimension', async () => {
    const source = await makePng(200, 120)

    const result = await generateThumbnail(source)

    expect(result.success).toBe(true)
    if (result.success) {
      const image = await Jimp.fromBuffer(Buffer.from(result.data.data, 'base64'))
      expect(image.width).toBeLessThanOrEqual(200)
      expect(image.height).toBeLessThanOrEqual(120)
    }
  })

  it('returns an error for data that is not a valid image', async () => {
    const result = await generateThumbnail(Buffer.from('this is not an image'))

    expect(result.success).toBe(false)
  })
})
