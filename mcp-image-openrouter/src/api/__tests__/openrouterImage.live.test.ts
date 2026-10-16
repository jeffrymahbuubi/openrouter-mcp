/**
 * OPT-IN live smoke test: ONE real `openai/gpt-5-image` call through the real
 * client, at OpenRouter quality "medium" (about $0.06). Skipped unless BOTH
 * RUN_LIVE_SMOKE and OPENROUTER_API_KEY are set, so the default `npm test` /
 * `npm run check:all` stay offline and free.
 *
 *   bash:        RUN_LIVE_SMOKE=1 npx vitest run src/api/__tests__/openrouterImage.live.test.ts
 *   PowerShell:  $env:RUN_LIVE_SMOKE=1; npx vitest run src/api/__tests__/openrouterImage.live.test.ts
 *
 * The key is read from <package>/.env or the repo-root .env (see loadEnv). On
 * Windows, Node's fetch may need NODE_OPTIONS=--network-family-autoselection-attempt-timeout=500.
 * `fetch` is wrapped by a pass-through spy only to inspect the request body; the
 * call is real. Output goes to os.tmpdir() only.
 *
 * Overrides: LIVE_SMOKE_IMAGE_MODEL (default openai/gpt-5-image) and
 * LIVE_SMOKE_IMAGE_QUALITY (low | medium | high, default medium). The quality
 * override is test-only and is never a public tool parameter.
 */

import '../../utils/loadEnv'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Config } from '../../utils/config'
import { analyzeImage } from '../../utils/thumbnail'
import { createOpenRouterImageClient } from '../openrouterImageClient'

const enabled = Boolean(process.env['RUN_LIVE_SMOKE']) && Boolean(process.env['OPENROUTER_API_KEY'])
const MODEL = process.env['LIVE_SMOKE_IMAGE_MODEL'] ?? 'openai/gpt-5-image'
const QUALITY = process.env['LIVE_SMOKE_IMAGE_QUALITY'] ?? 'medium'
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PROMPT =
  'A clean flat flowchart on a plain white background: three rectangular boxes in a row connected by right-pointing arrows. The boxes are labelled exactly "Input", "Encoder" and "Output". No other text.'

function liveConfig(): Config {
  return {
    openrouterApiKey: process.env['OPENROUTER_API_KEY'] ?? '',
    baseUrl: process.env['OPENROUTER_BASE_URL'] ?? 'https://openrouter.ai/api/v1',
    textModel: 'google/gemini-3.5-flash',
    imageModel: MODEL,
    imageModelHq: MODEL,
    imageOutputDir: tmpdir(),
    apiTimeout: 30000,
    imageApiTimeout: 180000,
    skipPromptEnhancement: true,
    imageQuality: 'quality',
    inlinePreview: false,
  }
}

describe('live smoke: openai/gpt-5-image via POST /images', () => {
  it.skipIf(!enabled)(
    'delivers a 3:2 PNG for a 16:9 / 4K request with warnings and real metadata',
    async () => {
      if (!['low', 'medium', 'high'].includes(QUALITY)) {
        throw new Error(`LIVE_SMOKE_IMAGE_QUALITY must be low, medium or high, got "${QUALITY}"`)
      }
      const realFetch = globalThis.fetch
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation((...args) => realFetch(...args))

      try {
        const created = createOpenRouterImageClient(liveConfig())
        if (!created.success) throw created.error

        const result = await created.data.generateImage({
          prompt: PROMPT,
          aspectRatio: '16:9',
          imageSize: '4K',
          quality: 'quality',
          openrouterQuality: QUALITY as 'low' | 'medium' | 'high',
        })
        if (!result.success) throw result.error

        const { imageData, metadata } = result.data
        const outDir = mkdtempSync(join(tmpdir(), 'mcp-image-smoke-'))
        const outPath = join(outDir, 'smoke.png')
        writeFileSync(outPath, imageData)

        const analysis = await analyzeImage(imageData, { withPreview: false })
        if (!analysis.success) throw analysis.error

        console.log(
          JSON.stringify({
            model: MODEL,
            openrouterQuality: QUALITY,
            path: outPath,
            bytes: imageData.length,
            mimeType: metadata.mimeType,
            width: analysis.data.width,
            height: analysis.data.height,
            durationMs: metadata.durationMs,
            requested: metadata.requested,
            delivered: metadata.delivered,
            warnings: metadata.warnings,
          })
        )

        expect(metadata.mimeType).toBe('image/png')
        expect(imageData.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
        expect(metadata.requested).toEqual({ aspectRatio: '16:9', imageSize: '4K' })
        expect(metadata.delivered).toEqual({ aspectRatio: '3:2', imageSize: null })
        expect(metadata.warnings.some((w) => w.includes('16:9'))).toBe(true)
        expect(metadata.warnings.some((w) => w.includes('4K'))).toBe(true)
        expect(metadata.durationMs).toBeGreaterThan(0)
        if (MODEL === 'openai/gpt-5-image') {
          expect(analysis.data.width).toBe(1536)
          expect(analysis.data.height).toBe(1024)
        }

        const post = fetchSpy.mock.calls.find(([, init]) => init?.method === 'POST')
        const init = post?.[1] as RequestInit | undefined
        const body = JSON.parse(String(init?.body))
        expect(body.quality).toBe(QUALITY)
        expect(body.aspect_ratio).toBe('3:2')
        expect(body.resolution).toBeUndefined()
      } finally {
        fetchSpy.mockRestore()
      }
    },
    240000
  )
})
