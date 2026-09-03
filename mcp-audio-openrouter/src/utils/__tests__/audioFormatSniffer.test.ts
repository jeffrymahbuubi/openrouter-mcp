import { describe, expect, it } from 'vitest'
import { sniffAudioFormat } from '../audioFormatSniffer'

describe('sniffAudioFormat', () => {
  it('detects a RIFF/WAVE buffer as wav', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('WAVE', 'ascii'),
      Buffer.alloc(10),
    ])
    expect(sniffAudioFormat(buf)).toBe('wav')
  })

  it('detects an ID3v2-tagged buffer as mp3', () => {
    const buf = Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.alloc(20)])
    expect(sniffAudioFormat(buf)).toBe('mp3')
  })

  it('detects a raw MPEG frame sync as mp3', () => {
    const buf = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00])
    expect(sniffAudioFormat(buf)).toBe('mp3')
  })

  it('returns unknown for unrecognized bytes', () => {
    expect(sniffAudioFormat(Buffer.from('not audio data'))).toBe('unknown')
  })

  it('returns unknown for a too-short buffer', () => {
    expect(sniffAudioFormat(Buffer.from([0x01, 0x02]))).toBe('unknown')
  })
})
