/**
 * Shape-only validation for voice identifiers.
 *
 * Voice ids are provider-specific (GPT Audio: `alloy`; ElevenLabs: `george`;
 * Azure: `en-US-Harper:MAI-Voice-2.1`), so membership is checked against the
 * model's catalog `supported_voices` at call time, never against a closed
 * list here. See docs/SPEC.md D11.
 */

export const VOICE_ID_MAX_LENGTH = 128

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/**
 * Returns a human-readable problem description, or `null` when the voice id
 * is a non-empty (after trim), at most 128-character string with no control
 * characters.
 */
export function describeVoiceIdProblem(voice: string): string | null {
  if (voice.trim().length === 0) {
    return 'voice must be a non-empty string'
  }
  if (voice.length > VOICE_ID_MAX_LENGTH) {
    return `voice must be at most ${VOICE_ID_MAX_LENGTH} characters (got ${voice.length})`
  }
  if (CONTROL_CHARACTERS.test(voice)) {
    return 'voice must not contain control characters'
  }
  return null
}
