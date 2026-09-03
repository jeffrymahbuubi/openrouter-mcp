# mcp-audio-openrouter — Spec & Locked Decisions

## Purpose

An MCP server exposing two OpenRouter-backed audio generation tools:
`generate_voice` (spoken dialogue/narration via `openai/gpt-audio`) and
`generate_music` (instrumental background music via Google's Lyria 3).
Sibling project to `resources/mcp-image-openrouter`, cloning its
architecture: provider-neutral client interfaces, `Result<T,E>` error
handling, lazy env-driven config, and file-on-disk output with a JSON
resource response (never inline binary).

## Locked decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | `length: "clip" \| "long"` enum on `generate_music`, mapped internally to `OPENROUTER_MUSIC_MODEL` / `OPENROUTER_MUSIC_MODEL_LONG`, rather than exposing raw OpenRouter model slugs as a tool parameter. | Matches the image project's `quality: fast\|balanced\|quality` → model-tier pattern. Callers pick an outcome, not a vendor slug; underlying Lyria preview slugs can be repointed via config without a tool-schema break. |
| D2 | One shared `AudioClient` (`src/api/audioClient.ts` interface, `src/api/openrouterAudioClient.ts` impl) serves both `generate_voice` and `generate_music`, rather than splitting into two client files like the image project's `imageClient`/`textClient`. | Both tools hit the *identical* endpoint, request envelope, and SSE response shape (`/chat/completions` + `modalities:["text","audio"]` + `stream:true`). Splitting would duplicate the SSE-reassembly engine, which is the one genuinely hard piece of logic here. A private `streamAudioCompletion()` is shared; the public methods differ only in request-building and metadata shape. |
| D3 | No inline audio preview in tool responses — only a `file://` resource + JSON metadata text block. | Unlike the image project's small downscaled-thumbnail preview (a few KB), audio clips are large (a 30s WAV is roughly 2-5 MB; longer clips more) — inlining any meaningful fraction would blow the ~25,000-token MCP response budget the image project's own code explicitly guards against. This is a stronger case for text-only, not a weaker one. If a short preview is ever wanted, MCP's native `AudioContent` content-block type (`type:'audio'`) is the correct extension point — deliberately not built now (out of scope per the approved plan). |
| D4 | Raw `fetch` + manual SSE `ReadableStream` parsing instead of the `openai` npm SDK for the streaming audio request. | Same rationale the image project used to bypass the SDK for its dedicated Images API: the SDK doesn't expose a typed accumulator for multi-chunk base64 + transcript reassembly. Raw `fetch` gives full control over concatenating base64 *fragments* (which are not independently valid base64) before a single terminal `Buffer.from(..., 'base64')` decode. |
| D5 | No cost/usage figure surfaced in tool response metadata. | Whether OpenRouter's SSE stream includes a final `usage`/cost chunk for these two models is unverified (see `docs/OPENROUTER_API.md` §3) — omitted rather than guessed. Revisit once the Phase-0 live-key spike confirms the actual final-chunk shape. |
| D6 | Audio API timeout defaults to 120000ms, versus the image project's 30000ms for a single non-streaming call. | A Lyria 3 Pro track can stream for on the order of a couple of minutes; a 30s timeout tuned for a single non-streaming image request would false-positive on legitimate long generations. |
| D7 | `AudioAPIError` (this project) replaces the image project's `GeminiAPIError`/`ImageAPIError` split with a single provider-error class, and does the generic-name rename the image project's own code flags as a TODO (`GeminiAPIError` → a provider-neutral name) rather than perpetuating the legacy naming. | No legacy compatibility constraint exists in a brand-new package, so there's no reason to carry the old name forward. |
| D8 | `generate_voice`'s tool-facing `format` enum stays `wav \| mp3` (no `pcm16`), even though the wire request to OpenRouter always sends `pcm16` for voice. | **Verified live** (2026-09-03): `openai/gpt-audio` rejects `wav`/`mp3` at the wire level with HTTP 400 when `stream:true` ("Supported values are: 'pcm16'"). Rather than leaking that wire-level detail into the public tool schema, the client always requests `pcm16` and wraps the raw PCM into a real WAV file itself (`src/utils/pcmToWav.ts`) — so the tool always returns a valid, playable WAV. `mp3` remains in the schema for symmetry with `generate_music` but is not currently honored for voice (documented in the tool description); music's `format` is sent to OpenRouter as-is and `wav` is confirmed working there. |
| D9 | `generate_music`'s response mime type is derived by sniffing the actual returned bytes' magic numbers (`src/utils/audioFormatSniffer.ts`), not by trusting the requested `format` param. | **Verified live** (2026-09-03): requesting `audio.format: "wav"` for `google/lyria-3-clip-preview` succeeds (HTTP 200) but the returned bytes are actually MP3 (ID3v2-tagged) — the request doesn't error, it's just silently not honored. Trusting the request would have saved/labeled real MP3 data as `audio/wav`. An `unknown` sniff result falls back to the requested format's mime type (logged) rather than failing the whole generation over a labeling ambiguity. Voice doesn't need this: `generate_voice` builds its own WAV container deterministically from raw PCM (D8), so its output format is controlled by construction, not by trusting the provider. |
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
   │     └─ streamAudioCompletion()    (shared SSE engine, raw fetch)
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
- No dedicated cheap-TTS tool via `/audio/speech` (e.g. `gpt-4o-mini-tts`) —
  `generate_voice` deliberately wraps `openai/gpt-audio` specifically, per
  the approved plan.
- No stem separation, voice cloning, or audio post-processing.
- No `Lyria RealTime` (streaming/live music generation) — not confirmed
  available via OpenRouter; only the `-clip-`/`-pro-` preview models are
  wired up.
