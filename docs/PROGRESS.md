# PROGRESS — live tracker

> **Live document.** This is the volatile companion to `docs/SPEC.md` (stable spec)
> and `docs/OPENROUTER_API.md` (verified API reference). Update it every session.
> Restore order after `/clear`: `SPEC.md` → `OPENROUTER_API.md` → this file.

**Last updated:** 2026-07-12

---

## ✅ Project complete (2026-07-11)

All phases 0–10 done. `check:all` green (186 mocked tests); live end-to-end verified
(3/3 scenarios with the real OpenRouter key). The build is functional and documented.

### Post-completion (2026-07-11)

- **README example gallery:** added an "Example Use-Cases" section showing prompt → tool
  call → result, using the three real live-test renders committed to `docs/examples/`
  (`example-1-text-to-image.png`, `example-2-edit.png`, `example-3-quality.png`).
- **Git repository:** initialized (`git init`, branch `main`) and pushed to GitHub —
  **`jeffrymahbuubi/mcp-image-openrouter` (private)**,
  <https://github.com/jeffrymahbuubi/mcp-image-openrouter>. Initial commit `cec0753`
  (later doc updates follow). `.gitignore` excludes `node_modules/`, `dist/`, `.env`,
  `output/`, `references/` (had its own nested `.git`), and ruflo artifacts.

### Feature: inline image preview (2026-07-12) — ✅ done

- New `src/utils/thumbnail.ts` (jimp, pure-JS): `generateThumbnail(Buffer)` →
  downscaled JPEG (≤`THUMBNAIL_MAX_DIM`=512px, quality 60) as base64; only downscales,
  never upscales; best-effort (returns `Err` on non-image input).
- `IMAGE_INLINE_PREVIEW` config (default `true`); `McpContent` extended with an
  `image` variant; `responseBuilder.buildSuccessResponse(…, preview?)` appends an MCP
  `image` block; `mcpServer` generates the thumbnail after save (warns + path-only on
  failure). So Claude Desktop renders the image inline; full-res still saved to disk.
- TDD: 4 thumbnail tests + 1 config test + 2 integration tests (preview present /
  absent). **Suite 193 tests green; `check:all` green.** Added `jimp` dependency.
- npm publish-ready: `prepublishOnly: npm run build`, `repository`/`homepage`/`bugs`
  metadata; `npm pack --dry-run` confirms only `dist`/`bin`/`skills`/`README`/`LICENSE`
  ship (no `src`/tests/`.env`/`docs`/`output`). README has npx + publishing sections.

### Known follow-ups / ideas (not blocking)

- **Inline image preview:** ✅ DONE (2026-07-12, see above) — Claude Desktop now renders the
  image inline via a downscaled preview; full-res still on disk.
- **Distribution / npx:** ✅ PUBLISHED to npm (2026-07-12) — `mcp-image-openrouter@0.1.0`
  (public, latest tag), <https://www.npmjs.com/package/mcp-image-openrouter>. Verified
  end-to-end: `npx -y mcp-image-openrouter@0.1.0` fetches from the registry, boots the MCP
  server, and answers `initialize` + `tools/list` (generate_image). Clients can now use
  `npx -y mcp-image-openrouter`; local `node dist/index.js` still works too. Future releases:
  `npm version patch|minor` → `npm publish` (needs 2FA OTP: `npm publish --otp=<code>`).
- Optional (now detailed in **SPEC §12 Future work**): CI + release workflow (`.github/workflows/`),
  genericize residual `GeminiAPIError` naming, widen the image-model capability map, downscale the
  ~5MB `docs/examples/` PNGs, enable "require 2FA for publish" on npm.

## ⏰ Standing reminders

- [x] **Real key added to `.env`** (2026-07-11) and live test passed. `.env` is
  gitignored; the key stays local. Unit/integration tests still mock the SDK/fetch and
  need no key.

---

## Session decisions (2026-07-11) — locked

- **D8 — Docs layout:** 3-doc split → `SPEC.md` (stable) + `OPENROUTER_API.md`
  (verified API facts) + `PROGRESS.md` (this live tracker). Testing conventions
  live in SPEC §10, not a separate file.
- **D9 — Targets:** Must work in **both Claude Code and Claude Desktop**. Same
  stdio server; only client config differs. `IMAGE_OUTPUT_DIR` must be **absolute**
  for Claude Desktop.
- **D10 — Run model:** Local build for now. Build to `dist/`, point both clients at
  `node dist/index.js`. `.env` (dotenv, non-overriding) for dev/testing. Publish to
  npm later if desired.
- **D11 — TDD:** **Vitest** + `@vitest/coverage-v8` + **Biome** (all inherited from
  the reference). Per-feature test-first (red→green→refactor via `npm run test:watch`).
  Track coverage but **no hard threshold gate** while iterating.

---

## Work phases & status

| # | Phase | Status |
|---|-------|--------|
| 0 | SPEC + README written | ✅ done |
| 1 | Docs restructured (3-doc split) | ✅ done |
| 2 | Verify OpenRouter API via **context7** → fill `OPENROUTER_API.md` | 🟢 VERIFIED (2026-07-11) — context7 queried against `/websites/openrouter_ai`; **model IDs confirmed live** via `GET /api/v1/images/models`. `OPENROUTER_API.md` filled (all 7 checklist items ✅ except tier sign-off + text-model pick). **Outcome:** use **Surface A = dedicated Images API** (`POST /api/v1/images` → `data[].b64_json`). It serves the Gemini models AND, on that surface, they expose native `aspect_ratio`/`resolution` + `input_references` (editing) — which the chat surface does not. Confirmed Gemini slugs: `gemini-2.5-flash-image`, `gemini-3.1-flash-image`(+lite), `gemini-3-pro-image` (+`-preview` variants). **DECISIONS LOCKED (user sign-off 2026-07-11):** Surface A (Images API); `OPENROUTER_IMAGE_MODEL=google/gemini-3.1-flash-image`, `OPENROUTER_IMAGE_MODEL_HQ=google/gemini-3-pro-image`, `OPENROUTER_TEXT_MODEL=google/gemini-3.5-flash`. **(d) DONE (2026-07-11):** exact `POST /api/v1/images` contract confirmed in `OPENROUTER_API.md` §3 — request `{model,prompt,aspect_ratio?,resolution?,n?,input_references?,…}`; editing via `input_references:[{type:"image_url",image_url:{url}}]` (same shape as chat image_url; Gemini 0–14 refs); `n` clamped to 1; response `data[].b64_json` is **raw** base64 (no data: prefix). **Only remaining Phase-2 loose end:** (c) SDK approach — raw `fetch` vs `@openrouter/sdk` for the image client (openai SDK doesn't hit `/api/v1/images`); decide during Phase 3 scaffolding. |
| 3 | Scaffold project root (copy reference src minus removed providers; new package.json; vitest/biome/tsconfig; `.env.example` + dotenv) | ✅ done (2026-07-11) — **(c) LOCKED: raw `fetch`** for the image client (text client keeps `openai` SDK for chat.completions). Copied reusable src; pruned gemini/openai clients+tests; rewrote `config.ts` (OpenRouter env vars), `types/mcp.ts` (dropped `ImageProvider`), `mcpServer.ts` (no provider branch); added `openrouterTextClient.ts`/`openrouterImageClient.ts` **stubs** (return NOT_IMPLEMENTED — the red state for Phase 4/5); new `package.json` (dropped `@google/genai`, added `dotenv`), `.env.example`, dotenv wired in entrypoints, vitest scoped to `src/` (excludes `references/`). **Verified:** `tsc` build ✅, **159 tests ✅**, biome ✅, dpdm no-circular ✅. knip shows 2 *expected pending-use* items (`errorClassification.ts`, `ImageGenerationMetadata`) that Phase 4/5 consume. |
| 4 | TDD `openrouterTextClient.ts` (test-first, mocked SDK) | ✅ done (2026-07-11) — red→green→refactor. `chat.completions.create` against `config.textModel`; reads `choices[0].message.content`; system instruction as `system` msg; edit-context image as `image_url` data-URL part; empty/blocked → ImageAPIError; network → NetworkError; API error carries status. **11 new tests, full suite 170 ✅**, build/biome ✅. (Consumes `errorClassification.ts` → clears one knip item.) |
| 5 | TDD `openrouterImageClient.ts` (test-first, raw-fetch mocked; feature-folding per D4) | ✅ done (2026-07-11) — red→green→refactor. Raw `fetch` POST `{baseUrl}/images`; static per-model capability map (native `aspect_ratio`/`resolution` when supported, else fold into prompt); quality→HQ model; `n:1`; editing via `input_references`; `useGoogleSearch` soft hint; decode raw `b64_json`; media_type→mimeType; HTTP/network error classification. **12 new tests.** |
| 6 | Wire clients in `mcpServer.ts` + full generate-flow test (mock clients) | ✅ done (2026-07-11) — integration test `mcpServer.generate.test.ts` (4 tests, both client factories + fileManager mocked): full enhance→generate→save→resource flow; `SKIP_PROMPT_ENHANCEMENT` bypasses Stage 1; image-gen failure → error response (no save); missing key → CONFIG_ERROR. |
| 7 | Remove gemini/openai clients + tests; `knip`/`check:deps` clean | ✅ done — providers removed (Phase 3); **knip clean** (both pending items consumed by the Phase 4/5 clients); `check:deps` no circular. |
| 8 | `check:all` green (lint/format/deps/build/test) | ✅ done (2026-07-11) — full `npm run check:all` passes: biome check + lint + format:check + dpdm + knip + tsc build + **182 tests**. |
| 9 | ⏰ Add real key to `.env`; live end-to-end test (text→image, edit, quality tier) | ✅ done (2026-07-11) — user added real key; **3/3 live scenarios PASSED** against real OpenRouter: S1 text→image (fast, gemini-3.1-flash-image) 1.6MB PNG; S2 image edit via `input_references` (same subject, new background) 1.5MB PNG; S3 quality tier (gemini-3-pro-image) 1.9MB PNG. Full pipeline (Stage-1 enhance → Images API → save) confirmed; no contract surprises. Images visually verified. |
| 10 | Client config docs for Claude Code + Claude Desktop in README | ✅ done (2026-07-11) — added **Claude Desktop** config (`claude_desktop_config.json`, macOS/Windows paths, absolute-path warning) + project `.mcp.json` for Claude Code; corrected README to the verified reality (Images API, native params-when-supported, confirmed model defaults, status → implemented). |

## Feature TDD checklist (Phases 4–5)

Each item = a failing test first, then implementation.

**Text client (Stage 1 — prompt enhancement)** — ✅ ALL DONE (Phase 4)
- [x] success: returns enhanced text from `choices[0].message.content`
- [x] image-context (edit) enhancement: attaches input image as `image_url` data URL
- [x] empty / blocked response handling
- [x] network / API error → classified error
- [x] respects configured text model + attribution headers

**Image client (Stage 2 — generation/editing)** — ✅ ALL DONE (Phase 5) — Surface A (OPENROUTER_API.md §3)
- [x] success text-to-image: `POST {baseUrl}/images`, decode `data[0].b64_json` (raw base64, no prefix)
- [x] image-to-image (editing): attach input image via `input_references:[{type:'image_url',image_url:{url}}]`
- [x] native params when supported: `aspect_ratio` / `resolution`; else fold hint into prompt (D4)
- [x] `imageSize`→`resolution` only when the active model supports it (2.5-flash has none)
- [x] `useGoogleSearch` treated as soft hint (no hard error)
- [x] quality tier → `OPENROUTER_IMAGE_MODEL_HQ` when `quality`, base model otherwise; `n` fixed at 1
- [x] missing image data / empty response → clear error; network / API error → classified error
- [ ] network / API error → classified error

## Notes / blockers

- Phase 2 context7 verification DONE (2026-07-11) — see `docs/OPENROUTER_API.md` §0.
  SPEC §6 hypothesis (chat `modalities`→`message.images[]`) was **not confirmed**; the
  documented paths are the Images API (`POST /api/v1/images`, base64 `b64_json`) and the
  `openrouter:image_generation` server tool. **Do not write client code yet** — first
  make the A/B/C surface decision and confirm the Gemini image model slugs live.
- SDK wrinkle: Surface A uses `/api/v1/images`, which the `openai` SDK's
  `.images.generate()` does not target → may need raw `fetch` or `@openrouter/sdk`.
- Header wrinkle: docs say `X-OpenRouter-Title`; SPEC assumed `X-Title`. Confirm.
