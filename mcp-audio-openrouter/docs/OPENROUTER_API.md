# OpenRouter Audio API — Contract Notes

Status: **verified live** (2026-09-03) — the Phase-0 spike this file was
meant to record has now been run against real `generate_voice` and
`generate_music` calls with a valid key. One real correction was found and
fixed (see §2) versus the original documentation-only draft of this file.

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
TTS-only models (e.g. `openai/gpt-4o-mini-tts`) and is out of scope here.

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

## Verification history

- **2026-09-03**: Ran both `generate_voice` (`openai/gpt-audio`) and
  `generate_music` (`google/lyria-3-clip-preview`) through the actual built
  client (`dist/api/openrouterAudioClient.js`), not just raw curl. Music
  succeeded first try (744,607-byte WAV, valid RIFF/WAVE header). Voice
  failed with the HTTP 400 documented in §2 (`audio.format` must be
  `pcm16` when streaming) — fixed in `openrouterAudioClient.ts` +
  `pcmToWav.ts`, then re-verified successfully.

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
