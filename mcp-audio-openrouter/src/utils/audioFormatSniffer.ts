/**
 * Detects the real container/codec of an audio buffer by its magic bytes.
 *
 * Needed because providers don't reliably honor the requested
 * `audio.format` on OpenRouter's streaming chat-completions audio endpoint.
 * Verified live (2026-09-03): requesting `audio.format: "wav"` for
 * `google/lyria-3-clip-preview` returns HTTP 200 with bytes that are
 * actually MP3 (ID3v2-tagged), not WAV — the request succeeds, so nothing
 * throws, but trusting the requested format for the response's mimeType
 * would silently mislabel the saved file. See docs/OPENROUTER_API.md §2.
 */

export type SniffedAudioFormat = 'wav' | 'mp3' | 'unknown'

/** MPEG audio frame sync: 11 set bits (0xFF followed by top 3 bits of the next byte set). */
function isMpegFrameSync(buffer: Buffer): boolean {
  if (buffer.length < 2) {
    return false
  }
  const first = buffer[0]
  const second = buffer[1]
  return first === 0xff && second !== undefined && (second & 0xe0) === 0xe0
}

/**
 * Inspect the leading bytes of a decoded audio buffer and report its real
 * format, independent of what format was requested from the provider.
 */
export function sniffAudioFormat(buffer: Buffer): SniffedAudioFormat {
  if (buffer.length >= 12) {
    const riff = buffer.subarray(0, 4).toString('ascii')
    const wave = buffer.subarray(8, 12).toString('ascii')
    if (riff === 'RIFF' && wave === 'WAVE') {
      return 'wav'
    }
  }

  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') {
    return 'mp3'
  }

  if (isMpegFrameSync(buffer)) {
    return 'mp3'
  }

  return 'unknown'
}
