# mcp-audio-openrouter

An OpenRouter-only MCP server for AI audio generation: spoken voice/dialogue
(via `openai/gpt-audio`) and instrumental background music (via Google's
Lyria 3). Sibling project to
[`mcp-image-openrouter`](../mcp-image-openrouter), cloning its architecture.

> **Status:** initial implementation. The exact OpenRouter streaming
> contract used by `openrouterAudioClient.ts` has not yet been verified
> against a live API key — see `docs/OPENROUTER_API.md` for what's confirmed
> vs. assumed, and its "Next verification step" for how to validate it.

## Tools

### `generate_voice`

Generate spoken voice/dialogue audio from a text prompt, with tone/delivery
instructions baked into the prompt.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `prompt` | string | ✅ | 1-4000 chars. Include delivery/emotion/pacing instructions inline. |
| `fileName` | string | – | Auto-generated if omitted. |
| `voice` | enum | – | `alloy \| echo \| fable \| onyx \| nova \| shimmer` |
| `format` | enum | – | `wav \| mp3` (default `wav`) |

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
`AUDIO_DEFAULT_FORMAT=wav`).

## Development

```bash
npm install
npm run test          # vitest, all clients mocked — no API key needed
npm run check:all      # biome + lint + format + circular-dep check + knip + tsc + vitest
npm run build           # tsc → dist/
```

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
