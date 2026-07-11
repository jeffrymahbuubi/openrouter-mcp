# SPEC — mcp-image, OpenRouter-only edition

> Technical build specification — the **stable source of truth** for the OpenRouter
> rewrite. Companion docs (3-doc split, D8): `docs/OPENROUTER_API.md` (verified API
> facts) and `docs/PROGRESS.md` (live status/TDD tracker). Restore after `/clear`:
> read this file → `OPENROUTER_API.md` → `PROGRESS.md` → `README.md`.
>
> **Source project:** `references/mcp-image/` (shinpr/mcp-image v0.11.3)
> **Target:** project root `mcp-image-shinpr-openrouter-version/` — an OpenRouter-only fork.
> **Runtime targets:** Claude Code **and** Claude Desktop (stdio transport; D9).

---

## 0. Status & how to resume

- **Phase:** SPEC + README written, docs restructured (3-doc split). **No implementation
  code yet.** Live status/next-steps tracked in `docs/PROGRESS.md`.
- **Next action after `/clear`:** restore context from this SPEC + `OPENROUTER_API.md` +
  `PROGRESS.md` + `README.md` + ruflo memory (namespace `mcp-image-openrouter`), then
  execute `PROGRESS.md` Phase 2 (context7 API verification) before any client coding.
- **Blocking dependency:** the exact OpenRouter request/response shapes in Section 6 are
  a **hypothesis based on training knowledge** and **MUST be confirmed via context7**
  (OpenRouter docs) before coding the two client files. Everything marked
  **⚠️ VERIFY (context7)** is unconfirmed.

---

## 1. Goal

Reuse shinpr/mcp-image (a two-stage "enhance prompt → generate image" MCP server) but
make it talk **only to OpenRouter**, removing the Google Gemini and OpenAI (native) providers.
Keep all the image-domain value: prompt optimization, image editing, quality tiers, aspect
ratios, resolution, character consistency, etc. — folding whatever OpenRouter can't express
as native API params into the prompt text instead.

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| D1 | Codebase scope | **OpenRouter-only rewrite.** Remove Gemini + OpenAI providers entirely. `IMAGE_PROVIDER` becomes irrelevant (drop it, or hard-pin to `openrouter`). |
| D2 | Image generation model | **Gemini image models, served via OpenRouter.** Quality tiers map to different model IDs (flash for fast/balanced, pro for quality). |
| D3 | Prompt-enhancement model | **Configurable via env var** (separate text model). |
| D4 | Gemini-only features | **Fold into the prompt text.** Aspect ratio, resolution, and "be factually accurate / use real-world knowledge" become natural-language hints in the prompt (OpenRouter chat image-gen has no native params for these). |
| D5 | README | New **user-facing** README for the OpenRouter edition (at project root). |
| D6 | Files layout | `docs/` at project root; `README.md` at root. |
| D7 | Memory | claude-flow/ruflo memory: minimal — decisions + pointers only. |
| D8 | Docs layout | **3-doc split:** `SPEC.md` (stable) + `OPENROUTER_API.md` (verified API facts) + `PROGRESS.md` (live tracker). Testing conventions stay in §10. |
| D9 | Runtime targets | Must run in **Claude Code and Claude Desktop**. Same stdio server; only client config differs. `IMAGE_OUTPUT_DIR` **absolute** for Desktop. |
| D10 | Run model | **Local build** for now: build `dist/`, both clients launch `node dist/index.js`. `.env` via **dotenv (non-overriding)** for dev/testing. npm publish deferred. |
| D11 | TDD stack | **Vitest** + `@vitest/coverage-v8` + **Biome** (inherited from reference). Per-feature test-first; track coverage, **no hard gate** while iterating. |

## 3. Why this project exists (design rationale — keep this intact)

The server is **not** a thin API wrapper. Its value is a two-stage pipeline:

1. **Stage 1 — Prompt optimization** (`src/business/structuredPromptGenerator.ts`): a cheap
   text LLM rewrites a short prompt using the **Subject–Context–Style** framework, injecting
   photographic/artistic detail (lighting, lens, composition, atmosphere, materials) into
   unspecified areas while preserving user-specified elements. Skippable via
   `SKIP_PROMPT_ENHANCEMENT=true`.
2. **Stage 2 — Image generation**: sends the enriched prompt + image settings to the image
   model, receives image bytes, saves to disk, returns an MCP resource.

Plus image-domain plumbing text chat doesn't need: base64 in/out, image-to-image **editing**,
MIME handling, PNG/JPEG/WebP, file saving, path-sanitization security, MCP resource response.

**This rationale is preserved unchanged in the OpenRouter edition.** Only the transport (which
provider/endpoint) changes.

## 4. Architecture (already provider-abstracted — this is what makes the port clean)

Two interfaces the whole server is built around:

- `TextClient` (`src/api/textClient.ts`) — prompt enhancement. Method: `generateText(prompt, config)`.
- `ImageClient` (`src/api/imageClient.ts`) — image gen/edit. Method: `generateImage(params)`.

`mcpServer.ts → initializeClients()` picks the concrete pair. **The port = implement these two
interfaces for OpenRouter and wire them in.** No business-logic, no MCP-tool-schema, no
file/security changes are required by the transport swap.

```
generate_image (MCP tool)
   └─ handleGenerateImage (mcpServer.ts)
        ├─ [Stage 1] StructuredPromptGenerator → TextClient.generateText   ← OpenRouterTextClient
        ├─ [Stage 2] ImageClient.generateImage                             ← OpenRouterImageClient
        ├─ FileManager.saveImage
        └─ ResponseBuilder.buildSuccessResponse
```

## 5. Work plan (files to add / modify / remove)

### 5.1 Add

| File | Purpose |
|------|---------|
| `src/api/openrouterTextClient.ts` | Implements `TextClient`. Uses `openai` SDK pointed at `https://openrouter.ai/api/v1`, calling **`chat.completions.create`** (NOT the Responses API). Supports optional input image for edit-context enhancement. |
| `src/api/openrouterImageClient.ts` | Implements `ImageClient`. Calls `chat.completions.create` with **`modalities: ["image","text"]`**; extracts base64 image from `message.images[]`. Supports image editing by attaching the input image to the user message. Folds aspect-ratio/size/world-knowledge hints into the outgoing prompt (per D4). |
| `src/api/__tests__/openrouterTextClient.test.ts` | Unit tests (mock SDK), mirroring existing openai text client tests. |
| `src/api/__tests__/openrouterImageClient.test.ts` | Unit tests (mock SDK), mirroring existing openai image client tests. |

### 5.2 Modify

| File | Change |
|------|--------|
| `src/utils/config.ts` | Replace provider/key config with OpenRouter env vars (Section 7). Validate `OPENROUTER_API_KEY`. Drop `IMAGE_PROVIDER`, `GEMINI_API_KEY`, `OPENAI_API_KEY`. Add model + optional base-URL + optional attribution-header vars. |
| `src/types/mcp.ts` | Remove `ImageProvider`/`IMAGE_PROVIDER_VALUES` and `GEMINI_MODELS`. Keep `AspectRatio`, `ImageSize`, `ImageQuality`, `GenerateImageParams`, response types. Optionally add default model constants. |
| `src/server/mcpServer.ts` | `initializeClients()`: drop the gemini/openai branching; always build the OpenRouter text + image clients. Remove now-dead imports. |
| `src/business/structuredPromptGenerator.ts` | (Optional) accept aspect-ratio/size so folding hints can be added here instead of in the image client. **Decision:** fold in the **image client** to keep Stage-1 output reusable and the enhancer provider-agnostic. So likely NO change here beyond comments. |
| `package.json` | Remove `@google/genai` dependency. **Keep `openai`** (reused as the OpenRouter transport). Update `description`, keywords, name if desired. |
| `README.md` | Already written (OpenRouter edition). |

### 5.3 Remove

| File | Reason |
|------|--------|
| `src/api/geminiClient.ts` + test | Gemini provider dropped. |
| `src/api/geminiTextClient.ts` + test | Gemini provider dropped. |
| `src/api/openaiImageClient.ts` + test | Native OpenAI Images API dropped (OpenRouter uses chat completions). |
| `src/api/openaiTextClient.ts` + test | Native OpenAI Responses API dropped. |

> Keep `errorClassification.ts`, `errors.ts`, `mimeUtils.ts`, `security.ts`, `fileManager.ts`,
> `inputValidator.ts`, `responseBuilder.ts`, `logger.ts`, `result.ts` — all provider-neutral.

## 6. OpenRouter API integration — ⚠️ VERIFY (context7) before coding

> The following is a **best-known hypothesis** from training data. Confirm every field name,
> endpoint, and header against OpenRouter docs via context7. Do not ship until verified.
> **Once verified, the confirmed facts move into `docs/OPENROUTER_API.md`** (D8) and this
> section links there instead of being the reference.

### 6.1 Client construction (both clients)

```ts
import OpenAI from 'openai'
const client = new OpenAI({
  apiKey: config.openrouterApiKey,
  baseURL: config.openrouterBaseUrl, // default 'https://openrouter.ai/api/v1'
  defaultHeaders: {                  // optional, for OpenRouter ranking/attribution
    ...(config.appUrl   && { 'HTTP-Referer': config.appUrl }),
    ...(config.appTitle && { 'X-Title': config.appTitle }),
  },
})
```

### 6.2 Prompt enhancement (text) — `openrouterTextClient.ts`

- Endpoint: `client.chat.completions.create`.
- Request: `{ model, messages: [{role:'system', content: systemInstruction}, {role:'user', content: <text | multimodal parts>}], temperature, max_tokens, top_p }`.
- Image-context (editing) enhancement: user `content` is an array:
  `[{type:'text', text}, {type:'image_url', image_url:{url:'data:<mime>;base64,<b64>'}}]`.
- Response text: `response.choices[0].message.content` (string). ⚠️ VERIFY.

### 6.3 Image generation / editing — `openrouterImageClient.ts`

- Endpoint: `client.chat.completions.create`.
- Request: `{ model, modalities: ['image','text'], messages:[{role:'user', content}] }`.
  - text-to-image: `content` = the (already enhanced) prompt string, **with folded hints appended** (D4).
  - image-to-image: `content` = `[{type:'text', text: prompt}, {type:'image_url', image_url:{url:'data:<mime>;base64,<b64>'}}]`.
- Response image location (⚠️ VERIFY): `response.choices[0].message.images` = array of
  `{ type:'image_url', image_url:{ url:'data:image/png;base64,<b64>' } }`. Parse the data URL,
  strip the `data:<mime>;base64,` prefix, `Buffer.from(b64,'base64')`.
- `modalities` may be a non-typed field on the SDK request → cast locally (same pattern the
  old `openaiImageClient.ts` used for size types).

### 6.4 Model selection by quality tier (D2)

Mirror the old `GEMINI_MODELS` map but env-driven:

| Quality | Model env var | Suggested default (⚠️ VERIFY exact OpenRouter ID) |
|---------|---------------|---------------------------------------------------|
| `fast` / `balanced` | `OPENROUTER_IMAGE_MODEL` | `google/gemini-2.5-flash-image-preview` (Nano Banana) |
| `quality` | `OPENROUTER_IMAGE_MODEL_HQ` (falls back to base if unset) | e.g. `google/gemini-3-pro-image-preview` |

- `balanced`: original raised Gemini "thinking level". OpenRouter chat image models likely
  won't expose that → treat `balanced` == `fast` model, or optionally add a reasoning param if
  the model supports it. ⚠️ VERIFY. Keep it simple: same model as `fast` unless proven otherwise.

## 7. Configuration / environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OPENROUTER_API_KEY` | ✅ | — | OpenRouter API key. |
| `OPENROUTER_TEXT_MODEL` | — | e.g. `google/gemini-2.5-flash` (⚠️ VERIFY) | Stage-1 prompt-enhancement model. |
| `OPENROUTER_IMAGE_MODEL` | — | e.g. `google/gemini-2.5-flash-image-preview` (⚠️ VERIFY) | Image model for `fast`/`balanced`. |
| `OPENROUTER_IMAGE_MODEL_HQ` | — | falls back to `OPENROUTER_IMAGE_MODEL` | Image model for `quality`. |
| `OPENROUTER_BASE_URL` | — | `https://openrouter.ai/api/v1` | Override endpoint if needed. |
| `OPENROUTER_APP_URL` | — | — | Optional `HTTP-Referer` for OpenRouter attribution. |
| `OPENROUTER_APP_TITLE` | — | — | Optional `X-Title` for OpenRouter attribution. |
| `IMAGE_OUTPUT_DIR` | — | `./output` | Absolute path recommended. Kept from original. |
| `IMAGE_QUALITY` | — | `fast` | `fast` \| `balanced` \| `quality`. Kept. |
| `SKIP_PROMPT_ENHANCEMENT` | — | `false` | Kept — sends prompt straight to image model. |

Removed: `IMAGE_PROVIDER`, `GEMINI_API_KEY`, `OPENAI_API_KEY`.

## 8. Feature-folding rules (D4)

Applied in `openrouterImageClient.ts` when assembling the final image-model prompt:

- **aspectRatio** → append e.g. `\n\nComposition: frame the image with a strict {ratio} aspect ratio.`
- **imageSize** (`1K`/`2K`/`4K`) → append e.g. `\n\nRender at high resolution (~{size}), with crisp fine detail and sharp text.`
- **useWorldKnowledge** → this already influences Stage-1 (mandatory-requirements block). For the
  image model, optionally append a factual-accuracy reminder.
- **useGoogleSearch** → **no real-time grounding available on OpenRouter chat image models.**
  Decision: accept the flag but treat it as a soft "be factually accurate" hint (do NOT hard-error
  like the old OpenAI provider did — since this is now the only provider). Document the limitation
  in README. ⚠️ Reconsider if a grounded model exists on OpenRouter (context7).
- **maintainCharacterConsistency / blendImages** → already handled by Stage-1's
  `buildEnhancedFeatureContext`; no image-client change needed.

Keep the MCP tool schema (`getToolsList`) parameters **unchanged** so client behavior/UX is stable;
only the backend interpretation changes.

## 9. Acceptance criteria

1. `npm run build` (tsc) passes with no Gemini/OpenAI imports remaining.
2. `npm test` green; new OpenRouter client tests cover: success, image-edit path, empty/blocked
   response, network error, missing image data.
3. Server boots with only `OPENROUTER_API_KEY` set; fails clearly if it's missing.
4. `generate_image` end-to-end: text-to-image saves a real file and returns an MCP resource.
5. Image editing (inputImagePath) round-trips through OpenRouter.
6. `SKIP_PROMPT_ENHANCEMENT=true` bypasses Stage 1.
7. `quality: "quality"` uses `OPENROUTER_IMAGE_MODEL_HQ`.
8. `knip` / `check:deps` clean (no dead exports from removed providers).

## 10. Testing

- Reuse the existing Vitest setup and the structure of the deleted OpenAI client tests as
  templates (mock the `openai` SDK’s `chat.completions.create`).
- Keep `structuredPromptGenerator.test.ts`, `inputValidator.test.ts`, `fileManager.test.ts`,
  `responseBuilder.test.ts`, `config.test.ts` — update `config.test.ts` for the new env vars.

## 11. Open questions to resolve via context7 (OpenRouter docs)

1. Exact response path for generated images (`message.images[]`? shape of each entry?).
2. Exact request field for multi-modal output (`modalities`? any per-model quirks?).
3. Current, correct OpenRouter model IDs for Nano Banana (flash) and the pro image model.
4. Whether image editing (input image → edited image) is supported for the chosen model and how
   the input image is attached.
5. Whether any native aspect-ratio / size params exist for any OpenRouter image model (would
   let us skip folding for those).
6. Whether a grounded/search-capable image path exists (for `useGoogleSearch`).
7. Recommended headers (`HTTP-Referer`, `X-Title`) and any rate/spend headers worth surfacing.
