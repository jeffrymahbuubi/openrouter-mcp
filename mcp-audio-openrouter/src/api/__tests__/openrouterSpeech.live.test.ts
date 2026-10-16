/**
 * OPT-IN live smoke test: one real call (mp3 + wav) to an ElevenLabs model
 * through the real client. Spends a few tenths of a cent of OpenRouter credit.
 *
 * Skipped unless BOTH RUN_LIVE_SMOKE and OPENROUTER_API_KEY are set, so the
 * default `npm test` / `npm run check:all` stay offline and free (R9).
 *
 *   bash:        RUN_LIVE_SMOKE=1 npx vitest run src/api/__tests__/openrouterSpeech.live.test.ts
 *   PowerShell:  $env:RUN_LIVE_SMOKE=1; npx vitest run src/api/__tests__/openrouterSpeech.live.test.ts
 *
 * `fetch` is deliberately NOT stubbed here. Output goes to os.tmpdir() only.
 * Model override: LIVE_SMOKE_VOICE_MODEL (default elevenlabs/eleven-v3).
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import '../../utils/loadEnv'
import { describe, expect, it } from 'vitest'
import { sniffAudioFormat } from '../../utils/audioFormatSniffer'
import type { Config } from '../../utils/config'
import { createOpenRouterAudioClient } from '../openrouterAudioClient'

const enabled = Boolean(process.env.RUN_LIVE_SMOKE) && Boolean(process.env.OPENROUTER_API_KEY)
const MODEL = process.env.LIVE_SMOKE_VOICE_MODEL ?? 'elevenlabs/eleven-v3'
// ~160 characters: long enough that the PCM-vs-mp3 duration comparison below can
// tell 22.05 kHz from 24 kHz (8.8% apart) despite small run-to-run pacing drift.
const PROMPT =
  'Hello, this is a short OpenRouter test. The quick brown fox jumps over the lazy dog, and then reads this sentence out loud at a calm, steady, natural speaking pace.'

/** MPEG-1 Layer III bitrates (kbps) by header index. */
const MPEG1_L3_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]

/** Estimates MP3 duration in seconds from the first frame's CBR bitrate. */
function estimateMp3Seconds(mp3: Buffer): number | null {
  let offset = 0
  if (mp3.subarray(0, 3).toString('ascii') === 'ID3') {
    const size =
      ((mp3[6] ?? 0) << 21) | ((mp3[7] ?? 0) << 14) | ((mp3[8] ?? 0) << 7) | (mp3[9] ?? 0)
    offset = 10 + size
  }
  for (let i = offset; i < Math.min(mp3.length - 4, offset + 4096); i++) {
    if (mp3[i] === 0xff && ((mp3[i + 1] ?? 0) & 0xe0) === 0xe0) {
      const bitrate = MPEG1_L3_BITRATES[((mp3[i + 2] ?? 0) >> 4) & 0x0f]
      if (!bitrate) return null
      return ((mp3.length - i) * 8) / (bitrate * 1000)
    }
  }
  return null
}

function liveConfig(): Config {
  return {
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
    baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    voiceModel: MODEL,
    voiceEndpoint: 'auto',
    musicModel: 'google/lyria-3-clip-preview',
    musicModelLong: 'google/lyria-3-pro-preview',
    audioOutputDir: tmpdir(),
    apiTimeout: 60000,
    defaultVoice: 'george',
    defaultAudioFormat: 'wav',
  }
}

describe('live smoke: ElevenLabs via /audio/speech', () => {
  it.skipIf(!enabled)(
    'generates playable mp3 and wav speech through generate_voice routing',
    async () => {
      const created = createOpenRouterAudioClient(liveConfig())
      if (!created.success) throw created.error
      const client = created.data
      const outDir = mkdtempSync(join(tmpdir(), 'mcp-audio-smoke-'))

      // --- mp3 ---
      const mp3 = await client.generateVoice({ prompt: PROMPT, voice: 'george', format: 'mp3' })
      if (!mp3.success) throw mp3.error
      expect(mp3.data.metadata.endpoint).toBe('speech')
      expect(mp3.data.metadata.mimeType).toBe('audio/mpeg')
      expect(sniffAudioFormat(mp3.data.audioData)).toBe('mp3')
      expect(mp3.data.audioData.length).toBeGreaterThan(1024)
      expect(mp3.data.metadata.generationId).toBeTruthy()
      const mp3Path = join(outDir, 'smoke.mp3')
      writeFileSync(mp3Path, mp3.data.audioData)

      // --- wav (PCM wrapped at the assumed 24 kHz mono) ---
      const wav = await client.generateVoice({ prompt: PROMPT, voice: 'george', format: 'wav' })
      if (!wav.success) throw wav.error
      expect(wav.data.metadata.endpoint).toBe('speech')
      expect(wav.data.metadata.mimeType).toBe('audio/wav')
      expect(sniffAudioFormat(wav.data.audioData)).toBe('wav')
      expect(wav.data.audioData.length).toBeGreaterThan(1024)
      const wavPath = join(outDir, 'smoke.wav')
      writeFileSync(wavPath, wav.data.audioData)

      // KTD4 check: the WAV header claims 24 kHz mono. If that is right, the
      // PCM duration should be close to the mp3 duration of the same sentence
      // (TTS pacing varies a little between calls, so the band is generous).
      const pcmBytes = wav.data.audioData.length - 44
      const headerRate = wav.data.audioData.readUInt32LE(24)
      const wavSeconds = pcmBytes / 2 / headerRate
      const mp3Seconds = estimateMp3Seconds(mp3.data.audioData)
      const impliedRate = mp3Seconds ? Math.round(pcmBytes / 2 / mp3Seconds) : null

      console.log(
        JSON.stringify({
          model: MODEL,
          mp3: {
            bytes: mp3.data.audioData.length,
            seconds: mp3Seconds,
            generationId: mp3.data.metadata.generationId,
            path: mp3Path,
          },
          wav: {
            bytes: wav.data.audioData.length,
            seconds: wavSeconds,
            generationId: wav.data.metadata.generationId,
            path: wavPath,
          },
          impliedPcmSampleRateHz: impliedRate,
        })
      )

      expect(wavSeconds).toBeGreaterThan(0.5)
      expect(wavSeconds).toBeLessThan(60)
      expect(mp3Seconds).not.toBeNull()
      // The rate implied by the mp3 duration must match the rate the WAV
      // header claims (within 5%); otherwise the wrapped WAV plays too fast
      // or too slow and the SPEECH_PCM_SAMPLE_RATE assumption is wrong.
      expect(Math.abs((impliedRate ?? 0) / headerRate - 1)).toBeLessThan(0.05)
    },
    60000
  )
})
