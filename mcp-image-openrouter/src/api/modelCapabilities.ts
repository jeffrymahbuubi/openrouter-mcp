/**
 * Per-model image parameter capabilities.
 *
 * Resolution order for a model id: in-memory cache -> live
 * `GET {baseUrl}/images/models/{id}/endpoints` -> `STATIC_CAPABILITIES` ->
 * `DEFAULT_CAPABILITIES`. A lookup failure never fails generation; it logs a
 * warning and falls through. The record that resolved is cached for the
 * process lifetime. Same shape as the audio server's `modelCatalog.ts`.
 *
 * `null` for a list means the model exposes no such parameter (as opposed to
 * an empty list). A model can have several endpoints with different enums
 * (e.g. `google/gemini-3-pro-image`: AI Studio `1K,2K,4K`, Vertex `1K,2K`);
 * the live parse takes the UNION so a value any endpoint accepts stays
 * requestable.
 */

import type { Config } from '../utils/config.js'
import { Logger } from '../utils/logger.js'

export interface ModelCapabilities {
  aspectRatios: string[] | null
  resolutions: string[] | null
  outputFormats: string[] | null
  quality: boolean
  background: boolean
}

export interface CapabilityResolver {
  resolve(model: string): Promise<ModelCapabilities>
}

const GEMINI_ASPECTS = [
  '1:1',
  '1:4',
  '1:8',
  '2:3',
  '3:2',
  '3:4',
  '4:1',
  '4:3',
  '4:5',
  '5:4',
  '8:1',
  '9:16',
  '16:9',
  '21:9',
]
// Gemini 2.5 / 3 Pro lack the extreme 1:4, 1:8, 4:1, 8:1 ratios.
const GEMINI_CLASSIC_ASPECTS = GEMINI_ASPECTS.filter(
  (a) => !['1:4', '1:8', '4:1', '8:1'].includes(a)
)
const GPT_NARROW_ASPECTS = ['1:1', '3:2', '2:3', 'auto']
const GPT_WIDE_ASPECTS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', 'auto']

function gemini(aspectRatios: string[], resolutions: string[] | null): ModelCapabilities {
  return { aspectRatios, resolutions, outputFormats: null, quality: false, background: false }
}

function gpt(aspectRatios: string[]): ModelCapabilities {
  return { aspectRatios, resolutions: null, outputFormats: null, quality: true, background: true }
}

/** Seeds from the live endpoint records of 2026-10-16; the stale-but-safe fallback. */
const STATIC_CAPABILITIES: Readonly<Record<string, ModelCapabilities>> = {
  'google/gemini-2.5-flash-image': gemini(GEMINI_CLASSIC_ASPECTS, null),
  'google/gemini-3.1-flash-lite-image': gemini(GEMINI_ASPECTS, ['1K']),
  'google/gemini-3.1-flash-image': gemini(GEMINI_ASPECTS, ['512', '1K', '2K', '4K']),
  'google/gemini-3.1-flash-image-preview': gemini(GEMINI_ASPECTS, ['512', '1K', '2K', '4K']),
  'google/gemini-3-pro-image': gemini(GEMINI_CLASSIC_ASPECTS, ['1K', '2K', '4K']),
  'google/gemini-3-pro-image-preview': gemini(GEMINI_CLASSIC_ASPECTS, ['1K', '2K', '4K']),
  'openai/gpt-5-image': gpt(GPT_NARROW_ASPECTS),
  'openai/gpt-5-image-mini': gpt(GPT_NARROW_ASPECTS),
  'openai/gpt-image-1': gpt(GPT_NARROW_ASPECTS),
  'openai/gpt-image-2': gpt(GPT_WIDE_ASPECTS),
  'openai/gpt-image-2.5-sunburst': gpt(GPT_WIDE_ASPECTS),
  'openai/gpt-image-2.5-flare': gpt(GPT_WIDE_ASPECTS),
}

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  aspectRatios: null,
  resolutions: null,
  outputFormats: null,
  quality: false,
  background: false,
}

interface ParameterRecord {
  values?: unknown
}

interface EndpointRecord {
  supported_parameters?: Record<string, ParameterRecord | undefined>
}

function enumValues(param: ParameterRecord | undefined): string[] {
  return Array.isArray(param?.values)
    ? param.values.filter((v): v is string => typeof v === 'string')
    : []
}

/** Union of one enum parameter across endpoints; `null` when no endpoint lists it. */
function unionOf(endpoints: EndpointRecord[], name: string): string[] | null {
  const listing = endpoints.filter((e) => e.supported_parameters?.[name] !== undefined)
  if (listing.length === 0) {
    return null
  }
  const union = new Set<string>()
  for (const endpoint of listing) {
    for (const value of enumValues(endpoint.supported_parameters?.[name])) {
      union.add(value)
    }
  }
  return [...union]
}

/** Returns `null` for a record that is missing, malformed, or has no endpoints. */
function parseEndpointsRecord(payload: unknown): ModelCapabilities | null {
  const endpoints = (payload as { endpoints?: unknown } | null)?.endpoints
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    return null
  }
  const records = endpoints.filter((e): e is EndpointRecord => typeof e === 'object' && e !== null)
  if (records.length === 0) {
    return null
  }
  const has = (name: string) => records.some((e) => e.supported_parameters?.[name] !== undefined)
  return {
    aspectRatios: unionOf(records, 'aspect_ratio'),
    resolutions: unionOf(records, 'resolution'),
    outputFormats: unionOf(records, 'output_format'),
    quality: has('quality'),
    background: has('background'),
  }
}

/** `openai/gpt-5-image` -> literal slash kept (the API 404s on `%2F`), segments encoded. */
function endpointsUrl(baseUrl: string, model: string): string {
  const path = model.split('/').map(encodeURIComponent).join('/')
  return `${baseUrl}/images/models/${path}/endpoints`
}

class CapabilityResolverImpl implements CapabilityResolver {
  private readonly logger = new Logger()
  private readonly cache = new Map<string, ModelCapabilities>()

  constructor(private readonly config: Config) {}

  async resolve(model: string): Promise<ModelCapabilities> {
    const cached = this.cache.get(model)
    if (cached) {
      return cached
    }
    const caps = (await this.fetchLive(model)) ?? STATIC_CAPABILITIES[model] ?? DEFAULT_CAPABILITIES
    this.cache.set(model, caps)
    return caps
  }

  private async fetchLive(model: string): Promise<ModelCapabilities | null> {
    try {
      const response = await fetch(endpointsUrl(this.config.baseUrl, model), {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.config.openrouterApiKey}` },
        signal: AbortSignal.timeout(this.config.apiTimeout),
      })
      if (!response.ok) {
        this.logger.warn('modelCapabilities', 'Capability lookup failed; using fallback', {
          model,
          status: response.status,
        })
        return null
      }
      const parsed = parseEndpointsRecord(await response.json())
      if (!parsed) {
        this.logger.warn('modelCapabilities', 'Capability record unusable; using fallback', {
          model,
        })
      }
      return parsed
    } catch (error) {
      this.logger.warn('modelCapabilities', 'Capability lookup errored; using fallback', {
        model,
        error: error instanceof Error ? error.message : 'unknown',
      })
      return null
    }
  }
}

export function createCapabilityResolver(config: Config): CapabilityResolver {
  return new CapabilityResolverImpl(config)
}
