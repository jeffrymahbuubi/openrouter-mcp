/**
 * Wraps raw, headerless PCM samples in a minimal 44-byte canonical WAV
 * (RIFF/WAVE) container so the bytes are a valid, playable audio file.
 *
 * Needed because OpenRouter's streaming chat-completions audio endpoint
 * (`/chat/completions` with `modalities:["text","audio"]`, `stream:true`)
 * rejects `audio.format: "wav"`/`"mp3"` for `openai/gpt-audio` — verified
 * live: the only accepted value when `stream:true` is `"pcm16"`, and the
 * response bytes are raw signed 16-bit little-endian PCM with no container.
 * See docs/OPENROUTER_API.md §2/§3.
 */

const WAV_HEADER_SIZE = 44
const BITS_PER_SAMPLE = 16
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8

/** OpenAI's documented pcm16 realtime/audio-output convention: 24kHz, mono. */
export const OPENAI_PCM16_SAMPLE_RATE = 24000
export const OPENAI_PCM16_CHANNELS = 1

/**
 * Build a canonical 44-byte WAV header for the given PCM payload size.
 */
function buildWavHeader(pcmByteLength: number, sampleRate: number, channels: number): Buffer {
  const byteRate = sampleRate * channels * BYTES_PER_SAMPLE
  const blockAlign = channels * BYTES_PER_SAMPLE
  const header = Buffer.alloc(WAV_HEADER_SIZE)

  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcmByteLength, 4)
  header.write('WAVE', 8, 'ascii')

  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk size (PCM)
  header.writeUInt16LE(1, 20) // audio format: 1 = PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(BITS_PER_SAMPLE, 34)

  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcmByteLength, 40)

  return header
}

/**
 * Wrap raw 16-bit PCM samples in a WAV container.
 * @param pcm Raw, headerless 16-bit little-endian PCM sample bytes.
 * @param sampleRate Defaults to OpenAI's documented pcm16 output rate (24kHz).
 * @param channels Defaults to mono (OpenAI's documented pcm16 output).
 */
export function pcm16ToWav(
  pcm: Buffer,
  sampleRate: number = OPENAI_PCM16_SAMPLE_RATE,
  channels: number = OPENAI_PCM16_CHANNELS
): Buffer {
  const header = buildWavHeader(pcm.length, sampleRate, channels)
  return Buffer.concat([header, pcm])
}
