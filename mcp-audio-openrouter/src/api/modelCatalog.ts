/**
 * OpenRouter speech-model catalog lookup.
 *
 * `generate_voice` must decide whether the configured voice model is a
 * speech-only TTS model (served by `/audio/speech`) or a chat-style audio
 * model (GPT Audio, served by `/chat/completions`). The decision comes from
 * the catalog (`GET /models?output_modalities=speech`), not from a model-name
 * prefix list that would go stale. The same payload carries each model's
 * `supported_voices`, which lets the caller fail fast on an unsupported voice.
 * See docs/SPEC.md D10 and docs/OPENROUTER_API.md §6.
 */

import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import type { Config } from '../utils/config.js'
import { AudioAPIError, type NetworkError, type TimeoutError } from '../utils/errors.js'
import { Logger } from '../utils/logger.js'
import { buildHttpError, classifyThrownError } from './errorClassification.js'

export interface VoiceModelInfo {
  /** True when the catalog marks the model `output_modalities: ["speech"]`. */
  speechOnly: boolean
  /** The model's fixed voice ids, or null when the catalog lists none. */
  supportedVoices: string[] | null
}

export interface ModelCatalog {
  describeVoiceModel(
    model: string
  ): Promise<Result<VoiceModelInfo, AudioAPIError | NetworkError | TimeoutError>>
}

interface CatalogEntry {
  id?: unknown
  architecture?: { output_modalities?: unknown }
  supported_voices?: unknown
}

const OVERRIDE_HINT =
  'Set OPENROUTER_VOICE_ENDPOINT=chat or OPENROUTER_VOICE_ENDPOINT=speech to skip the model catalog lookup, then retry'

function isSpeechOnly(entry: CatalogEntry): boolean {
  const modalities = entry.architecture?.output_modalities
  return Array.isArray(modalities) && modalities.length === 1 && modalities[0] === 'speech'
}

function toVoiceList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const voices = value.filter((v): v is string => typeof v === 'string')
  return voices.length > 0 ? voices : null
}

function parseCatalog(text: string): Map<string, VoiceModelInfo> | null {
  let payload: { data?: unknown }
  try {
    payload = JSON.parse(text) as { data?: unknown }
  } catch {
    return null
  }
  if (!payload || !Array.isArray(payload.data)) {
    return null
  }

  const models = new Map<string, VoiceModelInfo>()
  for (const entry of payload.data as CatalogEntry[]) {
    if (typeof entry?.id !== 'string') continue
    models.set(entry.id, {
      speechOnly: isSpeechOnly(entry),
      supportedVoices: toVoiceList(entry.supported_voices),
    })
  }
  return models
}

class ModelCatalogImpl implements ModelCatalog {
  private readonly logger = new Logger()
  private cache: Map<string, VoiceModelInfo> | undefined

  constructor(private readonly config: Config) {}

  async describeVoiceModel(
    model: string
  ): Promise<Result<VoiceModelInfo, AudioAPIError | NetworkError | TimeoutError>> {
    if (!this.cache) {
      const loaded = await this.loadCatalog()
      if (!loaded.success) {
        return Err(loaded.error)
      }
      this.cache = loaded.data
    }
    return Ok(this.cache.get(model) ?? { speechOnly: false, supportedVoices: null })
  }

  private async loadCatalog(): Promise<
    Result<Map<string, VoiceModelInfo>, AudioAPIError | NetworkError | TimeoutError>
  > {
    this.logger.info('modelCatalog', 'Fetching OpenRouter speech model catalog (once per process)')

    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}/models?output_modalities=speech`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.openrouterApiKey}`,
          ...(this.config.appUrl && { 'HTTP-Referer': this.config.appUrl }),
          ...(this.config.appTitle && { 'X-Title': this.config.appTitle }),
        },
        signal: AbortSignal.timeout(this.config.apiTimeout),
      })
    } catch (error) {
      return Err(classifyThrownError(error, this.config.apiTimeout))
    }

    if (!response.ok) {
      return Err(
        await buildHttpError(response, {
          model: this.config.voiceModel,
          stage: 'catalog_lookup',
          suggestion: OVERRIDE_HINT,
        })
      )
    }

    let text: string
    try {
      text = await response.text()
    } catch (error) {
      return Err(classifyThrownError(error, this.config.apiTimeout))
    }

    const models = parseCatalog(text)
    if (!models) {
      return Err(
        new AudioAPIError('OpenRouter model catalog response was not in the expected format', {
          provider: 'openrouter',
          model: this.config.voiceModel,
          stage: 'catalog_parse',
          suggestion: OVERRIDE_HINT,
        })
      )
    }
    return Ok(models)
  }
}

/**
 * Creates a catalog lookup. The first successful lookup is cached for the
 * lifetime of the returned object (the server holds one per process).
 */
export function createModelCatalog(config: Config): ModelCatalog {
  return new ModelCatalogImpl(config)
}
