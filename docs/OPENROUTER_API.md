# OPENROUTER_API — verified integration reference

> **Purpose:** the *verified* OpenRouter request/response facts this project depends on.
> Section 6 of `SPEC.md` is a hypothesis; this file graduates those facts to
> confirmed once checked against OpenRouter docs via **context7**.
>
> **Status:** 🟢 VERIFIED (2026-07-11). context7 unblocked; API shapes, model IDs, and the
> exact `POST /api/v1/images` request/response contract are confirmed (docs + live endpoint
> records). Image surface + tier models are LOCKED (user sign-off). Results **diverged from
> the SPEC §6 hypothesis** — see §0. **Only open item before coding:** SDK approach for the
> image client (raw `fetch` vs `@openrouter/sdk`, since the `openai` SDK doesn't target
> `/api/v1/images`) — decide during Phase 3 scaffolding.

**Last verified:** 2026-07-11
**Source:** context7 library `/websites/openrouter_ai` (official OpenRouter docs, benchmark 84.12).
Doc pages cited inline below.

---

## 0. ⚠️ Divergence from SPEC §6 hypothesis (read first)

The SPEC §6 hypothesis was: image generation via `chat.completions.create` with
`modalities:['image','text']`, reading the result from `choices[0].message.images[]`.
**The current OpenRouter docs do NOT foreground this path.** They document three
distinct image-generation surfaces instead:

| # | Surface | How image comes back | Native size/aspect? |
|---|---------|----------------------|---------------------|
| **A** | **Dedicated Images API** — `POST /api/v1/images` `{model,prompt}` | `data[].b64_json` (base64) + optional `media_type` | ✅ per-model `resolution` enum (1K/2K/4K) |
| **B** | **Server tool** — chat completions with `tools:[{type:"openrouter:image_generation"}]` | image **URL** embedded in `choices[0].message.content` (markdown); URL is temporary | ✅ tool `parameters`: `aspect_ratio`, `size`, `quality`, `background`, `output_format` |
| **C** | **Chat `modalities` → `message.images[]`** (the SPEC hypothesis) | OpenAPI schema `ChatAssistantImages` says images come back "as a URL or base64" | not surfaced in docs |

- Path **C** exists only as an OpenAPI *schema* reference (`ChatAssistantImages`). The
  `modalities:['image','text']` **request** field and a concrete `message.images[]`
  example were **NOT found** in the docs. Treat C as unconfirmed.
- Path **A** is the cleanest documented flow, returns base64 directly (no temp-URL
  fetch), and is closest to the original repo's `images.generate` pattern. **Recommended.**
  **Live check (2026-07-11) strengthens this:** the Images API serves the Gemini models
  this project wants, and on that surface they expose native `aspect_ratio` / `resolution`
  and `input_references` (editing) — none of which the chat surface gives. So Surface A
  both serves Gemini *and* removes most D4 folding. See §4.
- ⚠️ **SDK caveat for A:** OpenRouter's endpoint is `POST /api/v1/images` — NOT the
  OpenAI SDK's `/images/generations`. The `openai` npm client's `.images.generate()`
  likely won't hit the right path. Options: raw `fetch`, or adopt the official
  **`@openrouter/sdk`** (`import { OpenRouter } from '@openrouter/sdk'`), which the docs
  now use. This choice interacts with the "keep `openai` dep" decision in `project-context`.

**Blocking decision:** choose A / B / C before Phase 4–5. See PROGRESS Phase 2.

---

## Verification checklist (from SPEC §11)

| # | Question | Verified? | Answer / source |
|---|----------|-----------|-----------------|
| 1 | Response path for generated images | 🟡 | **Depends on surface.** A: `data[].b64_json` (+`media_type`). B: image URL inside `choices[0].message.content` markdown. C (`message.images[]`): schema only, no concrete example. Sources: `/docs/guides/overview/multimodal/image-generation`, `/docs/api/api-reference/chat/create-a-chat-completion`. |
| 2 | Request field for multimodal output (`modalities`?) | 🟡 | `modalities:['image','text']` **not found** in docs. Documented triggers are the Images API (`/api/v1/images`) or the `openrouter:image_generation` server tool. |
| 3 | Correct current model IDs (flash / pro image) | ✅ | **CONFIRMED live (2026-07-11) via `GET /api/v1/images/models`.** Gemini image slugs available: `google/gemini-2.5-flash-image`, `google/gemini-3.1-flash-image`(+`-preview`), `google/gemini-3.1-flash-lite-image`, `google/gemini-3-pro-image`(+`-preview`). See §4 for the tier picks. |
| 4 | Image editing / input image attach | ✅ | **Surface A:** editing = `input_references` param (all Gemini image models expose it). **Chat surface:** input images = `image_url:{url}` (https or base64 data URL), text-first ordering, one content entry per image (`/docs/guides/overview/multimodal/image-understanding`). |
| 5 | Native aspect-ratio / size params | ✅ | **YES — via the Images API, per model.** Gemini: all expose `aspect_ratio`; `resolution` on **3.x only** (`gemini-3.1-flash-image`, `gemini-3.1-flash-lite-image`, `gemini-3-pro-image`) — **NOT** on `gemini-2.5-flash-image` (aspect_ratio only). NOTE: via the *chat-completions* surface the same Gemini models expose **no** size/aspect params. Server tool takes `aspect_ratio`/`size`. → D4 folding: use native params when on Surface A; still fold `imageSize` if using 2.5-flash. |
| 6 | Grounded/search image path (`useGoogleSearch`) | 🟡 | No image-grounding path. Web search is a **text** feature via `tools:[{type:"openrouter:web_search"}]` (or deprecated `:online` suffix). D4 decision holds: keep `useGoogleSearch` a soft hint. |
| 7 | Attribution headers | 🟡 | `HTTP-Referer` **required** to create the app page / appear in rankings. Title header documented as **`X-OpenRouter-Title`** (must be paired with `HTTP-Referer`). ⚠️ SPEC assumed `X-Title` — confirm which alias the current API/SDK expects. Source: `/docs/app-attribution`. |

---

## 1. Client construction — verified (input side)

- OpenAI-compatible base URL: `https://openrouter.ai/api/v1`.
- Chat multimodal **input** confirmed: user `content` array of
  `{type:'text', text}` and `{type:'image_url', image_url:{url}}`, where `url` is an
  https URL or a `data:<mime>;base64,<b64>` string. Send text first, then images.
- Official `@openrouter/sdk` exists (`import { OpenRouter } from '@openrouter/sdk'`;
  `openRouter.chat.send({...})`) — an alternative to the `openai` SDK.
- Headers: `HTTP-Referer` (required for attribution), `X-OpenRouter-Title` (⚠️ vs `X-Title`).

## 2. Text / prompt-enhancement request+response — verified

- Standard OpenAI-compatible `chat.completions.create`; enhanced text at
  `choices[0].message.content`. Multimodal input parts as in §1. No divergence here —
  the Stage-1 text client can proceed on the SPEC §6.2 shape.

## 3. Image generation / editing — Surface A CONTRACT (verified 2026-07-11)

**Endpoint:** `POST https://openrouter.ai/api/v1/images`
Sources: context7 `/docs/guides/overview/multimodal/image-generation`,
`/docs/api/api-reference/images/generate-an-image` (`ImageGenerationRequest` schema),
+ live per-endpoint records `GET /api/v1/images/models/{id}/endpoints`.

### 3.1 Request body

```jsonc
{
  "model": "google/gemini-3.1-flash-image",   // REQUIRED
  "prompt": "a red panda astronaut, studio lighting", // REQUIRED
  "aspect_ratio": "16:9",   // optional, enum — provider clamps to supported subset
  "resolution": "2K",       // optional, enum — per-model (see §4 / capability notes)
  "n": 1,                    // optional, 1–10 generic; **Gemini clamps to 1** (single image)
  "input_references": [      // optional — image-to-image / EDITING; up to 16 (Gemini: 0–14)
    { "type": "image_url", "image_url": { "url": "data:image/png;base64,<b64>" } }
    // url may be a base64 data URL OR an http(s) URL — SAME shape as chat image_url parts
  ],
  "background": "transparent", // optional (needs alpha-capable output); not needed for Gemini
  "output_compression": 80     // optional 0–100 for webp/jpeg; ignored for PNG
}
```

- **Editing** = populate `input_references` with the input image as a data URL. Reuse the
  exact data-URL builder used for chat `image_url` parts (§1). No separate mechanism.

### 3.2 Response

```jsonc
{
  "created": 1748372400,
  "data": [ { "b64_json": "<raw base64>", "media_type": "image/svg+xml" /* omitted for raster PNG */ } ],
  "usage": { "prompt_tokens": 0, "completion_tokens": 4175, "total_tokens": 4175, "cost": 0.04 }
}
```

- Decode: `Buffer.from(data[0].b64_json, 'base64')` — **raw base64, NO `data:` prefix to strip**
  (differs from the SPEC §6.3 hypothesis, which assumed a data-URL to strip).
- Save `.png` unless `media_type` indicates otherwise. Gemini returns raster (no `media_type`).

### 3.3 Confirmed per-model capabilities (live endpoint records)

| Model | resolution enum | aspect_ratio | n | input_references |
|-------|-----------------|:---:|:---:|:---:|
| `google/gemini-3.1-flash-image` | `512, 1K, 2K, 4K` | 14 values inc. 1:1,16:9,9:16,21:9,4:3… | 1 only | 0–14 |
| `google/gemini-3-pro-image` | `1K, 2K` (Vertex) / `1K, 2K, 4K` (AI Studio) | 10 values | 1 only | 0–14 |
| `google/gemini-2.5-flash-image` | _(none)_ | ✅ | 1 only | ✅ |

→ **D4 handling:** pass `resolution`/`aspect_ratio` natively **only when the active model
supports the requested value**; otherwise fold that hint into the prompt text (the old
behavior). `n` is always 1 for Gemini — don't surface multi-image. Pricing is per output
token (~$6e-5/token for flash) — informational.

### Alternative surfaces (NOT chosen — kept for reference)
- **Surface B** — chat + `tools:[{type:"openrouter:image_generation", parameters:{…}}]`; image URL in `message.content` markdown; URLs temporary.
- **Surface C** — SPEC hypothesis (`modalities`→`message.images[]`); unconfirmed.

## 4. Confirmed model IDs — ✅ verified live (2026-07-11)

Source: `GET https://openrouter.ai/api/v1/images/models` (dedicated Images API list) and
`GET https://openrouter.ai/api/v1/models?output_modalities=image` (chat list). All Gemini
image models take `input_modalities: [image, text]` (so editing is supported).

**Available Gemini image models + native params (Images API):**

| Slug | aspect_ratio | resolution | input_references (edit) |
|------|:---:|:---:|:---:|
| `google/gemini-2.5-flash-image` | ✅ | ❌ | ✅ |
| `google/gemini-3.1-flash-lite-image` | ✅ | ✅ | ✅ |
| `google/gemini-3.1-flash-image` (+`-preview`) | ✅ | ✅ | ✅ |
| `google/gemini-3-pro-image` (+`-preview`) | ✅ | ✅ | ✅ |

**Tier mapping — LOCKED (user sign-off 2026-07-11):**

| Tier | Env var | Default | Rationale |
|------|---------|---------|-----------|
| fast / balanced | `OPENROUTER_IMAGE_MODEL` | ✅ `google/gemini-3.1-flash-image` | current flash; `resolution` + `aspect_ratio` support |
| quality | `OPENROUTER_IMAGE_MODEL_HQ` | ✅ `google/gemini-3-pro-image` | pro tier; `resolution` + `aspect_ratio` |
| text (Stage 1) | `OPENROUTER_TEXT_MODEL` | ✅ `google/gemini-3.5-flash` | newest stable flash, consistent w/ 3.x image choice; multimodal input (needed for edit-context enhancement) |

**Image surface — LOCKED: Surface A (dedicated Images API `POST /api/v1/images`).**

**Stage-1 text-model candidates** (confirmed live, `GET /api/v1/models`, all accept
`image` input, 1M ctx): `google/gemini-3.5-flash` (newest stable flash — proposed),
`google/gemini-2.5-flash` (conservative, SPEC's original guess), `google/gemini-3-flash-preview`
(preview), `~google/gemini-flash-latest` (floating alias — auto-tracks latest, less stable).

Non-Gemini image models also available if ever needed: `openai/gpt-5-image`,
`bytedance-seed/seedream-4.5`, `black-forest-labs/flux.2-*`, `recraft/*`, `microsoft/mai-image-2.5`.

## 5. Impact on locked decisions

- **D4 (feature folding):** `imageSize`/`aspectRatio` may now use **native** params
  (`resolution` enum, or `aspect_ratio`/`size` on the server tool) instead of prompt-text
  folding — revisit once the surface (A/B/C) is chosen.
- **"Keep `openai` dep" (project-context):** may need raw `fetch` or `@openrouter/sdk`
  for Surface A, since `.images.generate()` targets the wrong path. Revisit.
- **Headers:** confirm `X-Title` vs `X-OpenRouter-Title` before finalizing config.
