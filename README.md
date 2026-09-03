# openrouter-mcp

A collection of [Model Context Protocol](https://modelcontextprotocol.io/) servers, each wrapping a
different AI generation capability, all routed through a single **[OpenRouter](https://openrouter.ai)**
API key. Every server here is independent and self-contained — its own `package.json`, tests, docs,
and README — so you can install/run just the one(s) you need.

## Servers

| Server | What it does | Models |
|---|---|---|
| [`mcp-image-openrouter/`](mcp-image-openrouter/) | AI image generation & editing | Google Gemini image models (via OpenRouter) |
| [`mcp-audio-openrouter/`](mcp-audio-openrouter/) | Spoken voice/dialogue + instrumental music generation | `openai/gpt-audio` (voice), Google Lyria 3 (music) |

Each folder's own README has the full setup/usage instructions (MCP client config, environment
variables, example prompts). Each also documents its own architecture decisions in `docs/SPEC.md` and
a verified API contract in `docs/OPENROUTER_API.md`.

## Why one repo?

These servers don't depend on each other — they're grouped here purely so future OpenRouter-backed
MCP servers have one place to live, with one overview instead of a scattered repo per idea.
`mcp-image-openrouter/` also keeps its own standalone repo
([jeffrymahbuubi/mcp-image-openrouter](https://github.com/jeffrymahbuubi/mcp-image-openrouter)),
which stays dual-maintained alongside its copy here (its git history was folded in via `git subtree`,
so `git log` on that folder still shows the original commits).

## Adding a new server

New servers follow the same `mcp-<capability>-openrouter/` pattern and architecture: a
provider-neutral client interface behind a thin OpenRouter implementation, `Result<T,E>` error
handling (no throwing across module boundaries), lazy env-driven config, and a `docs/SPEC.md` +
`docs/OPENROUTER_API.md` + `docs/PROGRESS.md` doc triad. Look at `mcp-audio-openrouter/` for the
clearest from-scratch example of the pattern (`mcp-image-openrouter/` predates it and was ported
from an upstream fork, so it diverges slightly).

## License

MIT — see [`LICENSE`](LICENSE). `mcp-image-openrouter/` is a fork of
[shinpr/mcp-image](https://github.com/shinpr/mcp-image) and retains its own upstream-attributed
`LICENSE` file inside that subdirectory.
