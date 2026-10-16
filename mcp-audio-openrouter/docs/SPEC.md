# mcp-audio-openrouter — Spec & Locked Decisions

## Purpose

An MCP server exposing two OpenRouter-backed audio generation tools:
`generate_voice` (spoken dialogue/narration via `openai/gpt-audio` by
default, or ElevenLabs and other OpenRouter speech-only TTS models when
configured) and
`generate_music` (instrumental background music via Google's Lyria 3).
Sibling project to `resources/mcp-image-openrouter`, cloning its
architecture: provider-neutral client interfaces, `Result<T,E>` error
handling, lazy env-driven config, and file-on-disk output with a JSON
resource response (never inline binary).

## Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | `length: "clip" \| "long"` enum on `generate_music`, mapped internally to `OPENROUTER_MUSIC_MODEL` / `OPENROUTER_MUSIC_MODEL_LONG`, rather than exposing raw OpenRouter model slugs as a tool parameter. | Matches the image project's `quality: fast\|balanced\|quality` → model-tier pattern. Callers pick an outcome, not a vendor slug; underlying Lyria preview slugs can be repointed via config without a tool-schema break. |
| D2 | One shared `AudioClient` (`src/api/audioClient.ts` interface, `src/api/openrouterAudioClient.ts` impl) serves both `generate_voice` and `generate_music`, rather than splitting into two client files like the image project's `imageClient`/`textClient`. | Music and GPT Audio voice hit the *identical* endpoint (speech-only voice models take the separate `/audio/speech` path, see D10), request envelope, and SSE response shape (`/chat/completions` + `modalities:["text","audio"]` + `stream:true`). Splitting would duplicate the SSE-reassembly engine, which is the one genuinely hard piece of logic here. A private `streamAudioCompletion()` is shared; the public methods differ only in request-building and metadata shape. |
| D3 | No inline audio preview in tool responses — only a `file://` resource + JSON metadata text block. | Unlike the image project's small downscaled-thumbnail preview (a few KB), audio clips are large (a 30s WAV is roughly 2-5 MB; longer clips more) — inlining any meaningful fraction would blow the ~25,000-token MCP response budget the image project's own code explicitly guards against. This is a stronger case for text-only, not a weaker one. If a short preview is ever wanted, MCP's native `AudioContent` content-block type (`type:'audio'`) is the correct extension point — deliberately not built now (out of scope per the approved plan). |
| D4 | Raw `fetch` + manual SSE `ReadableStream` parsing instead of the `openai` npm SDK for the streaming audio request. | Same rationale the image project used to bypass the SDK for its dedicated Images API: the SDK doesn't expose a typed accumulator for multi-chunk base64 + transcript reassembly. Raw `fetch` gives full control over concatenating base64 *fragments* (which are not independently valid base64) before a single terminal `Buffer.from(..., 'base64')` decode. |
| D5 | No cost/usage figure surfaced in tool response metadata. | Whether OpenRouter's SSE stream includes a final `usage`/cost chunk for these two models is unverified (see `docs/OPENROUTER_API.md` §3) — omitted rather than guessed. Revisit once the Phase-0 live-key spike confirms the actual final-chunk shape. |
| D6 | Audio API timeout defaults to 120000ms, versus the image project's 30000ms for a single non-streaming call. | A Lyria 3 Pro track can stream for on the order of a couple of minutes; a 30s timeout tuned for a single non-streaming image request would false-positive on legitimate long generations. |
| D7 | `AudioAPIError` (this project) replaces the image project's `GeminiAPIError`/`ImageAPIError` split with a single provider-error class, and does the generic-name rename the image project's own code flags as a TODO (`GeminiAPIError` → a provider-neutral name) rather than perpetuating the legacy naming. | No legacy compatibility constraint exists in a brand-new package, so there's no reason to carry the old name forward. |
| D8 | `generate_voice`'s tool-facing `format` enum stays `wav \| mp3` (no `pcm16`), even though the wire request to OpenRouter always sends `pcm16` for voice. | **Verified live** (2026-09-03): `openai/gpt-audio` rejects `wav`/`mp3` at the wire level with HTTP 400 when `stream:true` ("Supported values are: 'pcm16'"). Rather than leaking that wire-level detail into the public tool schema, the client always requests `pcm16` and wraps the raw PCM into a real WAV file itself (`src/utils/pcmToWav.ts`) — so the tool always returns a valid, playable WAV. `mp3` remains in the schema for symmetry with `generate_music` but is not currently honored for voice (documented in the tool description); music's `format` is sent to OpenRouter as-is and `wav` is confirmed working there. |
| D9 | `generate_music`'s response mime type is derived by sniffing the actual returned bytes' magic numbers (`src/utils/audioFormatSniffer.ts`), not by trusting the requested `format` param. | **Verified live** (2026-09-03): requesting `audio.format: "wav"` for `google/lyria-3-clip-preview` succeeds (HTTP 200) but the returned bytes are actually MP3 (ID3v2-tagged) — the request doesn't error, it's just silently not honored. Trusting the request would have saved/labeled real MP3 data as `audio/wav`. An `unknown` sniff result falls back to the requested format's mime type (logged) rather than failing the whole generation over a labeling ambiguity. Voice doesn't need this: `generate_voice` builds its own WAV container deterministically from raw PCM (D8), so its output format is controlled by construction, not by trusting the provider. |
| D10 | `generate_voice` routes between two endpoints inside the one tool: speech-only TTS models (catalog `architecture.output_modalities == ["speech"]`) go to `POST /audio/speech`; everything else keeps the `/chat/completions` streaming path. Detection is a catalog lookup (`GET /models?output_modalities=speech`, unauthenticated, cached once per process in `src/api/modelCatalog.ts`), overridable with `OPENROUTER_VOICE_ENDPOINT=auto\|chat\|speech` (default `auto`; `chat`/`speech` skip the lookup). No ElevenLabs-specific branches; no per-call `model` parameter (model stays config-only, `OPENROUTER_VOICE_MODEL`, per D1). | A name-prefix list would go stale (the catalog already has 35 speech models across 15 vendors) and the catalog payload also carries each model's `supported_voices`, which enables the fail-fast voice check in D11. Cost: one GET on the first call. The override is the escape hatch for offline/proxy setups and mislabeled models. Chosen over a second tool (`generate_speech`) so callers keep one speech tool and the endpoint stays an implementation detail. |
| D11 | `voice` is a free string validated for shape only (non-empty after trim, at most 128 chars, no control characters, `src/utils/voiceId.ts`), not a closed enum. `OPENROUTER_VOICE_DEFAULT` uses the same rule and still defaults to `alloy`. On the speech path, when the catalog reports a non-empty `supported_voices` list and the resolved voice (explicit or default) is not in it, the call fails fast with `INPUT_VALIDATION_ERROR` naming the model and listing the supported voices, before any paid request. No silent substitution of a default voice. | Voice ids are provider-specific (`alloy`, `george`, `en-US-Harper:MAI-Voice-2.1`), so a closed list cannot serve more than one provider. Membership is data-driven from the catalog; shape validation keeps every previously valid value valid. Failing fast is deterministic and costs nothing; substituting a voice would hide a misconfiguration (e.g. the default `alloy` against an ElevenLabs model). |
| D12 | Speech-path format handling: `format: "mp3"` requests `response_format: "mp3"`; `format: "wav"` (the global default) requests `response_format: "pcm"` and wraps the 16-bit little-endian PCM in a WAV container at 24 kHz mono (`SPEECH_PCM_SAMPLE_RATE` in `src/api/speechEndpoint.ts`). The endpoint has no `wav` format. The response is raw bytes read with `arrayBuffer()`; the saved mime type comes from sniffing the bytes, then `Content-Type`, never from the request alone. A `Content-Type: audio/pcm` response is treated as PCM unless it carries a strong magic number (ID3 or RIFF/WAVE), because raw PCM can begin with bytes that the two-byte MPEG sync check mistakes for mp3. A 200 with a JSON body or zero bytes is an `AUDIO_API_ERROR` (`audio_extraction`). | Extends D9's "never trust the request" rule to the second endpoint. The 24 kHz rate was an assumption (OpenRouter documents PCM as 16-bit LE but states a rate only for Azure) and was **verified live 2026-10-16** against `elevenlabs/eleven-v3`: PCM sample count over mp3 duration of the same sentence implied 24,176 Hz (see `docs/OPENROUTER_API.md` §6). |
| D13 | Exactly one opt-in live smoke test (`src/api/__tests__/openrouterSpeech.live.test.ts`), a normal vitest file guarded by `it.skipIf(!RUN_LIVE_SMOKE \|\| !OPENROUTER_API_KEY)`. It calls `elevenlabs/eleven-v3` through the real client for both `mp3` and `wav`, writes only to `os.tmpdir()`, and checks the WAV header rate against the mp3 duration. Default `npm test` and `npm run check:all` stay offline (mocked `fetch`) and spend no credits. | One credit-spending check proves the contract end-to-end without a second vitest config or dependency; skipping by default keeps CI free. |
| D-empirical-first | Phase 0 of implementation is a live-key API spike verifying the exact SSE field names and Lyria request shape before the client code is treated as final — see `docs/OPENROUTER_API.md`. | Mirrors the image project's own methodology (`docs/OPENROUTER_API.md` §0: evaluate real surfaces before locking a design) rather than shipping unverified assumptions as fact. Initially built without a live key (flagged as outstanding), then **completed** once a key was provided — one real contract mismatch (D8) was caught and fixed as a direct result. |

## Architecture

```
generate_voice / generate_music (MCP tools)
        │
        ▼
  MCPServerImpl (src/server/mcpServer.ts)
   ├─ validateGenerateVoiceParams / validateGenerateMusicParams
   ├─ getConfig()                      (lazy, per-call)
   ├─ AudioClient.generateVoice/Music  (src/api/openrouterAudioClient.ts)
   │     ├─ generateVoice: route by OPENROUTER_VOICE_ENDPOINT / catalog (D10)
   │     │     ├─ modelCatalog.describeVoiceModel()  (src/api/modelCatalog.ts)
   │     │     ├─ speech-only model -> requestSpeech() (src/api/speechEndpoint.ts,
   │     │     │                        POST /audio/speech, raw audio bytes)
   │     │     └─ otherwise -> streamAudioCompletion()
   │     └─ streamAudioCompletion()    (shared SSE engine for GPT Audio + music)
   ├─ FileManager.saveAudio            (src/business/fileManager.ts)
   └─ ResponseBuilder.build*Response   (src/business/responseBuilder.ts)
```

The port pattern from the image project holds: swapping providers means
implementing `AudioClient` again and wiring it into `mcpServer.ts` — no
business-logic changes needed elsewhere.

## Non-goals (explicitly out of scope)

- No adaptive/interactive audio engine (intensity layers, gameplay-reactive
  transitions) — this server generates static clips; game-side mixing is the
  caller's responsibility.
- No separate tool for `/audio/speech`: speech-only TTS models (ElevenLabs,
  `gpt-4o-mini-tts`, ...) are reached through `generate_voice` by setting
  `OPENROUTER_VOICE_MODEL` (see D10). No per-call `model` parameter.
- No `instructions`, `speed`, multi-speaker `input`, or voice cloning
  (`input_references`) on the speech path; delivery direction stays inside
  the prompt text.
- No stem separation, voice cloning, or audio post-processing.
- No `Lyria RealTime` (streaming/live music generation) — not confirmed
  available via OpenRouter; only the `-clip-`/`-pro-` preview models are
  wired up.
