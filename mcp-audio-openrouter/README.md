# mcp-audio-openrouter

An OpenRouter-only MCP server for AI audio generation: spoken voice/dialogue
(via `openai/gpt-audio` by default, or ElevenLabs and other OpenRouter TTS
models) and instrumental background music (via Google's Lyria 3). Sibling project to
[`mcp-image-openrouter`](../mcp-image-openrouter), cloning its architecture.

> **Status:** the OpenRouter contract has been verified live for GPT Audio,
> Lyria 3, and ElevenLabs (`eleven-v3`) — see `docs/OPENROUTER_API.md` for
> what is confirmed vs. still unverified.

## Tools

### `generate_voice`

Generate spoken voice/dialogue audio from a text prompt, with tone/delivery
instructions baked into the prompt.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string | ✅ | 1-4000 chars. Include delivery/emotion/pacing instructions inline. |
| `fileName` | string | – | Auto-generated if omitted. |
| `voice` | string | – | Provider voice id, model-specific. GPT Audio: `alloy \| echo \| fable \| onyx \| nova \| shimmer`. ElevenLabs: `george`, `sarah`, `adam`, `alice`, ... (21 voices; see the model page). An id the configured model does not support is rejected with the list of supported voices before any paid request. Defaults to `OPENROUTER_VOICE_DEFAULT`. |
| `format` | enum | – | `wav \| mp3` (default `wav`). With ElevenLabs/other speech-only models `mp3` is honored and `wav` is built from PCM (24 kHz mono). With GPT Audio the output is always WAV. |

The speech model is chosen by `OPENROUTER_VOICE_MODEL`, not per call. Speech-only
models are detected from OpenRouter's catalog and sent to `/audio/speech`; GPT Audio
keeps the chat-completions path (see `docs/SPEC.md` D10).

### `generate_music`

Generate instrumental background music from a genre/mood/instrumentation
description.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string | ✅ | 1-4000 chars. Genre, mood, instrumentation, tempo, structure. |
| `fileName` | string | – | Auto-generated if omitted. |
| `length` | enum | – | `clip` (~30s, default) \| `long` (up to ~2 min) |
| `format` | enum | – | `wav \| mp3` (default `wav`) |

Both tools save the full audio file to disk under `AUDIO_OUTPUT_DIR` and
return a `file://` resource + JSON metadata — audio is never returned
inline (see `docs/SPEC.md` D3).

## Setup

### Claude Code (CLI)

```bash
claude mcp add mcp-audio-openrouter --env OPENROUTER_API_KEY=your-key -- node /absolute/path/to/dist/index.js
```

### `.mcp.json`

```json
{
  "mcpServers": {
    "mcp-audio-openrouter": {
      "command": "node",
      "args": ["/absolute/path/to/dist/index.js"],
      "env": {
        "OPENROUTER_API_KEY": "your-key"
      }
    }
  }
}
```

### Claude Desktop

Same shape, in `claude_desktop_config.json`. Use an **absolute path** for
`AUDIO_OUTPUT_DIR` if you set one.

### `npx`

```bash
npx mcp-audio-openrouter
```

## Environment variables

See `.env.example` for the full list. `OPENROUTER_API_KEY` is required;
everything else has a sensible default (`OPENROUTER_VOICE_MODEL=openai/gpt-audio`,
`OPENROUTER_MUSIC_MODEL=google/lyria-3-clip-preview`,
`OPENROUTER_MUSIC_MODEL_LONG=google/lyria-3-pro-preview`,
`AUDIO_OUTPUT_DIR=./output`, `OPENROUTER_VOICE_DEFAULT=alloy`,
`AUDIO_DEFAULT_FORMAT=wav`, `OPENROUTER_VOICE_ENDPOINT=auto`).

`OPENROUTER_VOICE_ENDPOINT` selects the voice endpoint: `auto` (default) looks the
model up in OpenRouter's speech catalog once per process; `chat` forces
`/chat/completions`; `speech` forces `/audio/speech`. `chat` and `speech` skip the
catalog lookup, which is the escape hatch for offline or proxy setups.

### ElevenLabs / other TTS models

Set the model and a matching default voice together (voice ids are per provider):

```bash
OPENROUTER_VOICE_MODEL=elevenlabs/eleven-v3
OPENROUTER_VOICE_DEFAULT=george
```

Other speech models (any catalog model with `output_modalities: ["speech"]`) work the
same way. Leaving `OPENROUTER_VOICE_DEFAULT` at `alloy` with an ElevenLabs model fails
fast with an `INPUT_VALIDATION_ERROR` listing the supported voices.

## Development

```bash
npm install
npm run test          # vitest, all clients mocked — no API key needed
npm run check:all      # biome + lint + format + circular-dep check + knip + tsc + vitest
npm run build           # tsc → dist/
```

### Live smoke test (opt-in, spends a few tenths of a cent)

One real call (`mp3` and `wav`) to `elevenlabs/eleven-v3` through the real client.
Skipped unless `RUN_LIVE_SMOKE` and `OPENROUTER_API_KEY` are both set; output goes to
the OS temp directory (the test logs the paths).

```bash
# bash (loads .env without echoing the key)
set -a; . ./.env; set +a
RUN_LIVE_SMOKE=1 npx vitest run src/api/__tests__/openrouterSpeech.live.test.ts
```

```powershell
# PowerShell
$env:OPENROUTER_API_KEY = "<your key>"; $env:RUN_LIVE_SMOKE = "1"
npx vitest run src/api/__tests__/openrouterSpeech.live.test.ts
```

Set `LIVE_SMOKE_VOICE_MODEL` to test a different speech model.

## Skills

A bundled Claude Code Skill teaches prompt-crafting for both tools (spoken
delivery for `generate_voice`, music-description vocabulary for
`generate_music`):

```bash
npx mcp-audio-openrouter skills install --path ~/.claude/skills
```

## Docs

- `docs/SPEC.md` — locked architecture decisions
- `docs/OPENROUTER_API.md` — the OpenRouter request/response contract this
  client relies on, with verified vs. unverified parts called out explicitly
- `docs/PROGRESS.md` — build session log
