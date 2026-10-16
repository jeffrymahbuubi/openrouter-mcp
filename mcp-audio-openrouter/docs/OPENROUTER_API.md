# OpenRouter Audio API — Contract Notes

Status: **verified live** (2026-09-03) — the Phase-0 spike this file was
meant to record has now been run against real `generate_voice` and
`generate_music` calls with a valid key. One real correction was found and
fixed (see §2) versus the original documentation-only draft of this file.
The text-to-speech endpoint (`/audio/speech`, §6) was added and verified live
on 2026-10-16 against `elevenlabs/eleven-v3`.

## §1 — Endpoint & mechanism

Both `openai/gpt-audio` (voice) and `google/lyria-3-clip-preview` /
`google/lyria-3-pro-preview` (music) are invoked via:

```
POST {OPENROUTER_BASE_URL}/chat/completions
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json
```

Confirmed via `GET /api/v1/models/openai/gpt-audio` and
`GET /api/v1/models/google/lyria-3-clip-preview` (2026-09-03): both models'
`architecture.modality` ends in `->text+audio`, and OpenRouter's own audio
guide documents `/chat/completions` with `modalities:["text","audio"]` as
the mechanism for exactly this shape of model — as opposed to the separate
`/audio/speech` endpoint, which is reserved for `output_modalities: "speech"`
TTS-only models (e.g. ElevenLabs, `openai/gpt-4o-mini-tts`). `generate_voice`
routes those models to `/audio/speech` (§6); this section and §2-§3 describe
the chat-completions path only.

Per OpenRouter's documentation, **audio output requires `stream: true`** —
the response arrives as Server-Sent Events, not a single JSON body.

## §2 — Request body

```json
{
  "model": "openai/gpt-audio",
  "messages": [{ "role": "user", "content": "<prompt>" }],
  "modalities": ["text", "audio"],
  "audio": { "voice": "alloy", "format": "wav" },
  "stream": true
}
```

- `model`: `openai/gpt-audio` for `generate_voice`; `google/lyria-3-clip-preview`
  or `google/lyria-3-pro-preview` for `generate_music` (selected by the
  `length` param — see `docs/SPEC.md` D1).
- `audio.voice`: one of `alloy | echo | fable | onyx | nova | shimmer`
  (documented voice set for OpenAI audio-output models). Live-tested with
  `alloy`; the full set is unverified but documented by OpenAI itself.
- `audio.voice` is **omitted** for music generation — Lyria 3's `get-model`
  response reports `supported_voices: null`, consistent with it being a
  pure-instrumental model with no voice concept. Live-tested: omitting
  `voice` entirely for `google/lyria-3-clip-preview` succeeds (HTTP 200,
  valid audio returned) — never sends one, sidestepping the "does it error
  or ignore" question.
- **`audio.format` — CORRECTED, verified live:** the wire-level format
  accepted here is **not** the same as this project's tool-facing
  `AudioFormat` (`'wav' | 'mp3'`). For `openai/gpt-audio` with
  `stream:true`, sending `audio.format: "wav"` fails with:
  ```
  HTTP 400 {"error":{"message":"Unsupported value: 'audio.format' does not
  support 'wav' when stream=true. Supported values are: 'pcm16'.",
  "type":"invalid_request_error","param":"audio.format",
  "code":"unsupported_value"}}
  ```
  So `openrouterAudioClient.ts` now **always sends `audio.format: "pcm16"`**
  for `generate_voice`, regardless of the tool's `format` param, and wraps
  the raw headerless 16-bit PCM response in a WAV container itself
  (`src/utils/pcmToWav.ts`, assuming OpenAI's documented pcm16 convention:
  24kHz, mono, 16-bit little-endian — this sample-rate/channel assumption
  has **not** been independently confirmed, e.g. via spectral inspection;
  only that the resulting WAV file is well-formed and plays). The tool's
  `mp3` option is accepted for schema symmetry with `generate_music` but is
  **not currently honored** for voice — output is always WAV.
  **`google/lyria-3-clip-preview` was live-tested with `audio.format: "wav"`
  and succeeded** (HTTP 200, 744,607-byte response for a ~30s clip) — Google's
  provider does not share OpenAI's pcm16-only streaming restriction, so the
  request itself doesn't error. **However**, the returned bytes were
  discovered to actually be **MP3** (ID3v2-tagged), not WAV — Lyria silently
  does not honor the requested container. `openrouterAudioClient.ts` now
  sniffs the real format from the decoded bytes' magic numbers
  (`src/utils/audioFormatSniffer.ts`: RIFF/WAVE → wav, ID3/MPEG-sync → mp3)
  and reports the *actual* mime type rather than trusting the request; an
  `unknown`-sniff result falls back to the requested format with a logged
  warning rather than throwing. `mp3` as an explicit *request* for music has
  **not** been separately live-tested (moot in practice, since `wav` already
  returns mp3 bytes) — worth confirming if Lyria's behavior is queried
  again.
- Lyria 3's `input_modalities` includes `image` (for image-to-music), but
  this project only sends `text` content — live-tested: a pure-text prompt
  with no image reference succeeds, confirming it's optional.

## §3 — Response (SSE)

Confirmed live for `google/lyria-3-clip-preview` (200 OK, valid decodable
audio produced end-to-end through `consumeSseStream`/`Buffer.from(...,
'base64')` with no parsing errors). `openai/gpt-audio`'s SSE shape itself
was not exercised in the same run (the 400 above is returned as a normal
JSON error body before any stream starts, so `buildHttpError`'s non-stream
path was what actually got tested for that model) — re-run the `pcm16`
curl command in "Next verification step" below to confirm the delta shape
for voice specifically if that matters for future work; documented shape
(from OpenRouter's `docs/guides/overview/multimodal/audio` page), assumed
to apply identically given the shared `modality` architecture field:

```
data: {"choices":[{"delta":{"audio":{"data":"<base64 fragment>","transcript":"Hel"}}}]}

data: {"choices":[{"delta":{"audio":{"data":"<base64 fragment>","transcript":"lo"}}}]}

data: [DONE]
```

- `choices[0].delta.audio.data`: a base64 **fragment** of the audio stream.
  Fragments are not individually valid/padded base64 — only the full
  concatenation across all chunks is decodable. `openrouterAudioClient.ts`
  joins all fragments before calling `Buffer.from(..., 'base64')` once.
- `choices[0].delta.audio.transcript`: incremental transcript text (voice
  only, in practice — music generation is not expected to populate this,
  though the client accumulates it defensively for both).
- `data: [DONE]` terminates the stream (standard SSE chat-completions
  convention); the client ignores this line rather than parsing it as JSON.
- **Unverified**: whether a final chunk carries a `usage` object with token
  counts/cost. If present, it isn't currently surfaced in tool response
  metadata — cost is omitted rather than guessed (see `docs/SPEC.md` D5).

## §4 — Pricing (for reference, verified via `get-model`/model pages, 2026-09-03)

- `openai/gpt-audio`: $2.5/M input tokens, $10/M output tokens, $32/M audio
  input tokens (no separate audio-output rate listed via OpenRouter's
  `get-model`, unlike the direct OpenAI rate of $64/M — OpenRouter's own
  pricing page should be treated as authoritative over third-party
  aggregators for this).
- `google/lyria-3-clip-preview`: effectively flat-rate, ~$0.04 per 30-second
  clip (the `get-model` `pricing` field shows `$0/M tokens`, since actual
  billing is per-generation, not per-token).
- `google/lyria-3-pro-preview`: ~$0.08 per full-length song, same flat-rate
  billing shape.

## §5 — Attribution headers

`HTTP-Referer` / `X-Title`, same as the sibling image project — sent when
`OPENROUTER_APP_URL` / `OPENROUTER_APP_TITLE` are configured. Not
specifically re-verified for the audio endpoint in this build; assumed
identical to the rest of OpenRouter's API surface.

## §6 — Text-to-speech endpoint (`/audio/speech`)

Used by `generate_voice` when the configured voice model is speech-only
(`architecture.output_modalities == ["speech"]`), or when
`OPENROUTER_VOICE_ENDPOINT=speech`. Sources: the OpenRouter TTS guide
(https://openrouter.ai/docs/guides/overview/multimodal/tts), the Create speech
API reference (https://openrouter.ai/docs/api/api-reference/tts/create-speech),
the per-model contract page (https://openrouter.ai/elevenlabs/eleven-v3/llms.txt),
and the Models API filter docs (https://openrouter.ai/docs/models).

```
POST {OPENROUTER_BASE_URL}/audio/speech
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json

{ "model": "elevenlabs/eleven-v3", "input": "<prompt>", "voice": "george", "response_format": "mp3" }
```

| Field | Notes |
|---|---|
| `model` | Required. Any catalog model with `output_modalities: ["speech"]`. |
| `input` | Required. The text to speak (the tool's `prompt`). |
| `voice` | Provider-specific id. ElevenLabs: one of `george, sarah, adam, alice, bella, bill, brian, callum, charlie, chris, daniel, eric, harry, jessica, laura, liam, lily, matilda, river, roger, will`. Azure: a full id with model suffix, e.g. `en-US-Harper:MAI-Voice-2.1`. |
| `response_format` | `mp3` or `pcm` only; default `pcm`. There is **no** `wav` (the API reference mentions it in a summary line but not in the enum). `pcm` is headerless 16-bit little-endian PCM. |
| `instructions`, `speed`, `provider.options` | Exist upstream; deliberately not sent (ElevenLabs ignores `instructions`). |

Success: HTTP 200 with the audio as **raw bytes** (not SSE, not base64).
`Content-Type` is `audio/mpeg` for `mp3` and `audio/pcm` for `pcm`; the
`X-Generation-Id` response header carries the generation id (surfaced as
`metadata.generationId`).

Failure: HTTP 400/401/402/403/404/413/429/500/502/503/524/529 with
`{"error":{"code":<n>,"message":"..."}}`. The client maps these to
`AUDIO_API_ERROR` with `statusCode` and a status-specific suggestion
(402 credits, 401 key, 429 rate limit, 400 mentioning `voice` -> check the
model's supported voices, 404 model, 5xx provider unavailable).

**Model discovery / routing.** `GET {OPENROUTER_BASE_URL}/models?output_modalities=speech`
works without authentication (verified 2026-10-16: 35 models, all
`architecture.modality: "text->speech"`, `output_modalities: ["speech"]`, each with a
top-level `supported_voices` array; `null` for Fish Audio and Seed Audio, which take
no fixed voice). ElevenLabs entries: `eleven-v4`, `eleven-v4-turbo`, `eleven-v3`,
`eleven-v3-conversational`, `eleven-flash-v2.5`, `eleven-turbo-v2`,
`eleven-multilingual-v2`, `eleven-turbo-v2.5`, `eleven-flash-v2`, all priced
`pricing.prompt: "0.00004"` per input character. The client fetches this once per
process and uses it for both routing and the supported-voices check
(`src/api/modelCatalog.ts`). The per-model route `GET /models/{slug}/endpoints` also
works unauthenticated but lacks `supported_voices`, so it is not used.

**Format handling in the client** (`src/api/speechEndpoint.ts`): tool `mp3` requests
`mp3`; tool `wav` requests `pcm` and wraps it with a canonical 44-byte WAV header at
**24 kHz, 16-bit, mono**. The saved mime type comes from sniffing the bytes, then
`Content-Type`. A 200 whose body is JSON or empty is an error (`audio_extraction`).

**PCM sample rate: verified live (2026-10-16, `elevenlabs/eleven-v3`, voice `george`).**
OpenRouter documents PCM as 16-bit little-endian but gives a rate only for Azure
(24 kHz mono). Method: request the same sentence as `mp3` and `pcm`, compare the PCM
sample count with the mp3 duration (counted from 128 kbps / 44.1 kHz MPEG frames).
A ~160-character sentence gave 11.83 s of mp3 vs 11.92 s of PCM at 24 kHz, an implied
rate of 24,176 Hz, so the 24 kHz header is right. Caveat: a first run with a
40-character sentence implied about 22.0 kHz (2.80 s mp3 vs 2.56 s PCM at 24 kHz). That
was run-to-run pacing variance, not a different rate; short sentences cannot tell
22.05 kHz from 24 kHz (8.8% apart), so the smoke test uses a longer sentence.

## Verification history

- **2026-09-03**: Ran both `generate_voice` (`openai/gpt-audio`) and
  `generate_music` (`google/lyria-3-clip-preview`) through the actual built
  client (`dist/api/openrouterAudioClient.js`), not just raw curl. Music
  succeeded first try (744,607-byte WAV, valid RIFF/WAVE header). Voice
  failed with the HTTP 400 documented in §2 (`audio.format` must be
  `pcm16` when streaming) — fixed in `openrouterAudioClient.ts` +
  `pcmToWav.ts`, then re-verified successfully.

- **2026-10-16**: Added the `/audio/speech` path. Ran the opt-in live smoke test
  (`src/api/__tests__/openrouterSpeech.live.test.ts`) against
  `elevenlabs/eleven-v3`, voice `george`, through the real client with
  `OPENROUTER_VOICE_ENDPOINT=auto`: HTTP 200 for both formats, `mp3` returned
  `audio/mpeg` ID3 bytes (189,378 bytes), `wav` returned PCM wrapped to a 572,204-byte
  24 kHz mono WAV. Findings in §6.

## Remaining open items (not yet independently confirmed)

- Exact sample rate/channel count of `openai/gpt-audio`'s pcm16 stream —
  assumed 24kHz mono (OpenAI's documented realtime/audio convention) based
  on the WAV file playing correctly, not on inspecting the raw sample data.
- Whether `google/lyria-3-clip-preview` genuinely always returns MP3
  regardless of the requested `audio.format`, or whether some other
  requested value would yield real WAV — only `"wav"` (→ actual mp3) has
  been live-tested; the format-sniffing fix makes this moot for
  correctness, but the underlying provider behavior itself isn't fully
  characterized.
- `google/lyria-3-pro-preview` (the "long" length tier) has not been
  live-tested — only `-clip-preview` has.
- Whether a final SSE chunk ever carries a `usage`/cost object (not
  observed in the successful runs so far, but not specifically logged for
  either).
- Full `alloy | echo | fable | onyx | nova | shimmer` voice set — only
  `alloy` was exercised.
- `/audio/speech` was live-tested only for `elevenlabs/eleven-v3` voice `george`;
  other speech models' PCM sample rates (the 24 kHz assumption is documented for
  Azure and verified for ElevenLabs v3) and the other 20 ElevenLabs voices are not
  independently confirmed. `format: "mp3"` avoids the rate assumption entirely.

To re-run the spike directly against curl (bypassing the built client) for
future debugging:

```bash
# Voice — must use pcm16, not wav/mp3, when stream:true
curl -N https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-audio","messages":[{"role":"user","content":"Say hello in a friendly tone."}],"modalities":["text","audio"],"audio":{"voice":"alloy","format":"pcm16"},"stream":true}'

# Music — wav works directly, no voice field
curl -N https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"google/lyria-3-clip-preview","messages":[{"role":"user","content":"A bright chiptune melody, retro 8-bit video game style, instrumental only."}],"modalities":["text","audio"],"audio":{"format":"wav"},"stream":true}'
```
