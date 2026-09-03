import { describe, expect, it } from 'vitest'
import { pcm16ToWav } from '../pcmToWav'

describe('pcm16ToWav', () => {
  it('produces a 44-byte RIFF/WAVE header followed by the raw PCM bytes', () => {
    const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06])
    const wav = pcm16ToWav(pcm, 24000, 1)

    expect(wav.length).toBe(44 + pcm.length)
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ')
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data')
    expect(wav.subarray(44)).toEqual(pcm)
  })

  it('encodes sample rate, channel count, and bit depth correctly', () => {
    const wav = pcm16ToWav(Buffer.alloc(100), 24000, 1)

    expect(wav.readUInt16LE(20)).toBe(1) // PCM format tag
    expect(wav.readUInt16LE(22)).toBe(1) // channels
    expect(wav.readUInt32LE(24)).toBe(24000) // sample rate
    expect(wav.readUInt16LE(34)).toBe(16) // bits per sample
    expect(wav.readUInt32LE(28)).toBe(24000 * 1 * 2) // byte rate
    expect(wav.readUInt16LE(32)).toBe(1 * 2) // block align
  })

  it('sets RIFF and data chunk sizes from the PCM payload length', () => {
    const pcm = Buffer.alloc(1000)
    const wav = pcm16ToWav(pcm)

    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length)
    expect(wav.readUInt32LE(40)).toBe(pcm.length)
  })

  it('defaults to 24kHz mono when unspecified', () => {
    const wav = pcm16ToWav(Buffer.alloc(10))

    expect(wav.readUInt32LE(24)).toBe(24000)
    expect(wav.readUInt16LE(22)).toBe(1)
  })
})
