# Progress Log

## 2026-09-03 — Initial implementation (Phases 0-8)

- **Phase 0 (API spike):** No live `OPENROUTER_API_KEY` was available in the
  build environment. Verified what's verifiable without a key: both
  `openai/gpt-audio` and `google/lyria-3-clip-preview`/`-pro-preview` report
  `architecture.modality` ending `->text+audio` via live `GET /api/v1/models/...`
  calls (no auth required), confirming both are reached through the same
  `/chat/completions` + `modalities:["text","audio"]` + `stream:true`
  mechanism documented in OpenRouter's audio guide. The exact SSE field
  names and Lyria's precise request shape are recorded as **best-effort,
  unverified** in `docs/OPENROUTER_API.md` — a live-key spike is still owed
  before treating the client as fully proven. See that file's "Next
  verification step" for the exact curl commands to run.
- **Phases 1-2 (scaffolding, config, utilities):** Cloned the sibling image
  project's tooling (`package.json`, `tsconfig.json`, `biome.json`,
  `knip.json`, `vitest.config.mjs`) with the audio-specific renames from
  `docs/SPEC.md`. `Config` gained `voiceModel`/`musicModel`/`musicModelLong`/
  `audioOutputDir`/`defaultVoice`/`defaultAudioFormat`; `AudioAPIError`
  replaces `GeminiAPIError`/`ImageAPIError` (D7); `mimeUtils`/`security`
  swapped to the audio MIME/extension allowlist.
- **Phase 3 (API client):** `src/api/audioClient.ts` interface +
  `src/api/openrouterAudioClient.ts` impl — one shared client (D2) with a
  private `streamAudioCompletion()` SSE engine (D4), tested against a mocked
  `ReadableStream` in `src/api/__tests__/openrouterAudioClient.test.ts`.
- **Phase 4 (business logic):** `fileManager.ts` (prefix-parameterized
  `generateFileName('voice'|'music', mimeType)`), `inputValidator.ts`
  (`validateGenerateVoiceParams`/`validateGenerateMusicParams`),
  `responseBuilder.ts` (`buildVoiceSuccessResponse`/`buildMusicSuccessResponse`,
  no inline preview per D3).
- **Phase 5 (server wiring):** `mcpServer.ts` exposes both `generate_voice`
  and `generate_music`, each with its own handler following the
  validate → config → client → save → respond pipeline; `errorHandler.ts`,
  `server-main.ts`, `index.ts` mirror the image project's shape.
- **Phase 6 (skills):** `skills/audio-generation/SKILL.md` covers both
  spoken-delivery prompt craft and music-description vocabulary in one file;
  `bin/install-skills.js` adapted for the `audio-generation` dir name.
- **Phase 7 (docs & polish):** This file, `docs/SPEC.md`,
  `docs/OPENROUTER_API.md`, `.env.example`, `README.md` written.
- **Phase 8 (verification):** `npm install` + `npm run check:all` run — see
  the result recorded at the bottom of this file once available.

## 2026-09-03 — Live-key spike run, one real bug found and fixed

A key was populated in `.env`. Ran the actual built client
(`dist/api/openrouterAudioClient.js`) against both real endpoints:

- **`generate_music`** (`google/lyria-3-clip-preview`): succeeded on the
  first try — 744,607-byte valid WAV file for a chiptune prompt.
- **`generate_voice`** (`openai/gpt-audio`): failed with HTTP 400 —
  `audio.format` does not support `'wav'` when `stream:true`; only
  `'pcm16'` is accepted. **Fixed**: `openrouterAudioClient.ts` now always
  requests `pcm16` for voice and wraps the raw PCM in a WAV container via
  the new `src/utils/pcmToWav.ts` (+ colocated test). Updated the two
  affected tests in `openrouterAudioClient.test.ts`, the `generate_voice`
  tool schema description (mp3 not currently honored), and
  `docs/OPENROUTER_API.md` §2/§3 with the corrected, verified contract.
  Re-ran `check:all` — still green (133/133 tests, one new file added).
  Re-verified `generate_voice` live after the fix: succeeded, playable WAV
  produced (127,244 bytes, 24kHz/mono/16-bit confirmed by header, ~2.65s,
  transcript "Hey there, so good to have you here!" matched the prompt's
  intent).

  Re-ran `generate_music` after the voice fix to get a fresh sample and
  inspected its WAV header — found a **second real bug**: the saved
  `music-test.wav` actually started with `ID3`, not `RIFF`/`WAVE` — Lyria 3
  silently returns MP3 bytes regardless of the requested `audio.format:
  "wav"`. **Fixed**: added `src/utils/audioFormatSniffer.ts` (magic-byte
  detection) and wired it into `generateMusic()` — the client now reports
  the mime type actually present in the returned bytes instead of trusting
  the request, with a warning log on mismatch and a safe fallback on
  unrecognized bytes. Added 5 sniffer unit tests + 2 client tests. Re-ran
  `check:all`: green, 140/140 tests. Re-verified both tools live one more
  time: `generate_voice` → valid WAV; `generate_music` → correctly
  mime-typed as `audio/mpeg` (matching its real MP3 content).

### Outstanding before this package should be considered production-ready

Remaining unverified items are narrower now — see
`docs/OPENROUTER_API.md`'s "Remaining open items" section (exact pcm16
sample rate/channels, mp3 for music, the "long"/pro music tier, the full
voice set, and whether a usage/cost chunk ever appears). None of these
block normal use; they're edge cases worth confirming before treating the
contract as fully exhaustive.

## 2026-10-16 — ElevenLabs (speech-only TTS) via `generate_voice`

Plan: `docs/plans/2026-10-16-1535-feat-elevenlabs-speech-endpoint-plan.md` (branch
`feat/audio-elevenlabs-speech`). Open questions were resolved by the user before
implementation: OQ1 catalog lookup plus `OPENROUTER_VOICE_ENDPOINT=auto|chat|speech`;
OQ2 keep the global `wav` default (request `pcm`, wrap at 24 kHz mono); OQ3 live smoke on
`elevenlabs/eleven-v3`; OQ4 no per-call `model` parameter; OQ5 fail fast on an
unsupported voice.

- `generate_voice` now routes speech-only models (catalog `output_modalities ==
  ["speech"]`) to `POST /audio/speech`; GPT Audio keeps `/chat/completions` unchanged.
  New modules `src/api/modelCatalog.ts` (cached once per process),
  `src/api/speechEndpoint.ts`, `src/utils/voiceId.ts`; shared HTTP error mapping moved to
  `src/api/errorClassification.ts` (adds 402 credits and voice-400 suggestions).
- `voice` is a free string (shape-only validation, <=128 chars, no control characters);
  `VOICE_VALUES` became the documentation constant `GPT_AUDIO_VOICES`. Unsupported voice
  for a speech-only model fails fast with `INPUT_VALIDATION_ERROR` listing the voices.
- Response metadata gained `endpoint` (`chat_completions` | `speech`) and `generationId`.
- Tests: written first (red confirmed per unit), all `fetch` mocked. Suite: 185 passed +
  1 skipped (the opt-in live test). `npm run check:all` green (biome, lint, format, dpdm,
  knip, tsc, vitest).
- **Live smoke (run twice in total, within the plan's two-run limit):**
  `elevenlabs/eleven-v3`, voice `george`, `OPENROUTER_VOICE_ENDPOINT=auto`, HTTP 200.
  Run 2 (160-character sentence): `mp3` 189,378 bytes, `audio/mpeg`, 11.83 s (generation id
  `gen-tts-1792140766-WMUyVm0we0Z8OzU498U7`); `wav` 572,204 bytes (PCM wrapped, 11.92 s at
  24 kHz, generation id `gen-tts-1792140769-Whonal0dMdPsXL98Q34v`). Implied PCM rate
  24,176 Hz, so KTD4's 24 kHz mono assumption holds. Run 1 (40-character sentence) implied
  about 22.0 kHz, which was pacing variance on a short sentence; the smoke test now uses a
  longer sentence and asserts the implied rate is within 5% of the WAV header rate.
  Details in `docs/OPENROUTER_API.md` §6.
