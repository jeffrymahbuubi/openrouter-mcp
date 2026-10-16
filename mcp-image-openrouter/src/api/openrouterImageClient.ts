/**
 * OpenRouter image client for Stage-2 generation / editing.
 *
 * Uses OpenRouter's dedicated Images API via a raw `fetch` POST to
 * `{baseUrl}/images` (decision (c): the OpenAI SDK's images.generate() targets
 * a different path). Verified contract: docs/OPENROUTER_API.md §3 —
 * request `{model,prompt,n,aspect_ratio?,resolution?,input_references?}`,
 * response `{data:[{b64_json,media_type?}]}` (raw base64). Request parameters are
 * shaped per model by `parameterMapping.ts` using `modelCapabilities.ts`.
 */

import type { ImageQuality } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import type { Config } from '../utils/config.js'
import { ImageAPIError, NetworkError, TimeoutError } from '../utils/errors.js'
import { DEFAULT_MIME_TYPE, normalizeMimeType } from '../utils/mimeUtils.js'
import { isNetworkError } from './errorClassification.js'
import type { GeneratedImageResult, ImageApiParams, ImageClient } from './imageClient.js'
import { type CapabilityResolver, createCapabilityResolver } from './modelCapabilities.js'
import { type MappedParameters, mapParameters } from './parameterMapping.js'

interface ImagesApiImage {
  b64_json?: string
  media_type?: string
}

interface ImagesApiResponse {
  data?: ImagesApiImage[]
}

interface ImagesApiRequest {
  model: string
  prompt: string
  n: number
  aspect_ratio?: string
  resolution?: string
  quality?: string
  output_format?: string
  background?: string
  input_references?: Array<{ type: 'image_url'; image_url: { url: string } }>
}

class OpenRouterImageClientImpl implements ImageClient {
  private readonly capabilities: CapabilityResolver

  constructor(private readonly config: Config) {
    this.capabilities = createCapabilityResolver(config)
  }

  async generateImage(
    params: ImageApiParams
  ): Promise<Result<GeneratedImageResult, ImageAPIError | NetworkError | TimeoutError>> {
    const tier = params.quality ?? this.config.imageQuality
    const model = this.selectModel(tier)
    const caps = await this.capabilities.resolve(model)
    const mapped = mapParameters({ ...params, quality: tier }, caps)
    const request = this.buildRequest(params, model, mapped)

    const startedAt = Date.now()
    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}/images`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.openrouterApiKey}`,
          'Content-Type': 'application/json',
          ...(this.config.appUrl && { 'HTTP-Referer': this.config.appUrl }),
          ...(this.config.appTitle && { 'X-Title': this.config.appTitle }),
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.config.imageApiTimeout),
      })
    } catch (error) {
      return this.handleThrownError(error)
    }

    if (!response.ok) {
      return Err(await this.buildHttpError(response, model))
    }

    let payload: ImagesApiResponse
    try {
      payload = (await response.json()) as ImagesApiResponse
    } catch (_error) {
      return Err(
        new ImageAPIError('Failed to parse OpenRouter image response', {
          provider: 'openrouter',
          model,
          stage: 'response_parse',
          suggestion: 'Retry the request; the provider returned a malformed response',
        })
      )
    }

    const image = payload.data?.[0]
    if (!image?.b64_json) {
      return Err(
        new ImageAPIError('No image data returned from OpenRouter image API', {
          provider: 'openrouter',
          model,
          stage: 'image_extraction',
          suggestion: 'Retry the request or verify that the selected model returns image data',
        })
      )
    }

    const mimeType = image.media_type ? normalizeMimeType(image.media_type) : DEFAULT_MIME_TYPE
    // Clamp to 1 ms so a real request is never reported as the untracked value 0.
    const durationMs = Math.max(1, Date.now() - startedAt)

    return Ok({
      imageData: Buffer.from(image.b64_json, 'base64'),
      metadata: {
        model,
        provider: 'openrouter',
        prompt: params.prompt,
        mimeType,
        timestamp: new Date(),
        inputImageProvided: !!params.inputImage,
        durationMs,
        requested: mapped.requested,
        delivered: mapped.delivered,
        warnings: mapped.warnings,
      },
    })
  }

  private selectModel(quality: ImageQuality): string {
    // 'balanced' shares the base (fast) model; only 'quality' uses the HQ model (D2).
    return quality === 'quality' ? this.config.imageModelHq : this.config.imageModel
  }

  private buildRequest(
    params: ImageApiParams,
    model: string,
    mapped: MappedParameters
  ): ImagesApiRequest {
    const request: ImagesApiRequest = {
      model,
      prompt: params.prompt + mapped.promptSuffix,
      n: 1,
    }

    if (mapped.aspect_ratio) request.aspect_ratio = mapped.aspect_ratio
    if (mapped.resolution) request.resolution = mapped.resolution
    if (mapped.quality) request.quality = mapped.quality
    if (mapped.output_format) request.output_format = mapped.output_format
    if (mapped.background) request.background = mapped.background

    // useGoogleSearch: no real-time grounding on OpenRouter image models — soft
    // hint only, never a hard error (D4).

    if (params.inputImage) {
      const mimeType = normalizeMimeType(params.inputImageMimeType ?? DEFAULT_MIME_TYPE)
      request.input_references = [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${params.inputImage}` } },
      ]
    }

    return request
  }

  private async buildHttpError(response: Response, model: string): Promise<ImageAPIError> {
    let upstreamMessage = `HTTP ${response.status}`
    try {
      const text = await response.text()
      if (text) {
        upstreamMessage = text
      }
    } catch {
      // ignore body read failures; status is enough
    }

    return new ImageAPIError(
      `OpenRouter image API request failed (HTTP ${response.status})`,
      {
        provider: 'openrouter',
        model,
        stage: 'image_generation',
        upstreamMessage,
        suggestion: this.getAPIErrorSuggestion(`${response.status} ${upstreamMessage}`, model),
      },
      response.status
    )
  }

  private handleThrownError(
    error: unknown
  ): Result<never, ImageAPIError | NetworkError | TimeoutError> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const name = error instanceof Error ? error.name : ''

    // `fetch` throws TimeoutError/AbortError when AbortSignal.timeout fires.
    if (name === 'TimeoutError' || name === 'AbortError') {
      return Err(
        new TimeoutError(
          `OpenRouter image generation exceeded ${this.config.imageApiTimeout} ms`,
          this.config.imageApiTimeout
        )
      )
    }

    // `fetch` throws TypeError on transport failure.
    if (isNetworkError(error) || error instanceof TypeError) {
      return Err(
        new NetworkError(
          'Network error during OpenRouter image generation',
          'Check your internet connection and try again',
          error instanceof Error ? error : undefined
        )
      )
    }

    return Err(
      new ImageAPIError('Failed to generate image with OpenRouter', {
        provider: 'openrouter',
        upstreamMessage: errorMessage,
        suggestion: 'Check OpenRouter API configuration and try again',
      })
    )
  }

  private getAPIErrorSuggestion(errorMessage: string, model: string): string {
    const lowerMessage = errorMessage.toLowerCase()

    if (lowerMessage.includes('quota') || lowerMessage.includes('rate limit')) {
      return 'You have exceeded your OpenRouter quota or rate limit. Wait before retrying or add credits'
    }
    if (lowerMessage.includes('401') || lowerMessage.includes('unauthorized')) {
      return 'Check that your OPENROUTER_API_KEY is valid and has image generation access'
    }
    if (
      lowerMessage.includes('404') ||
      lowerMessage.includes('model') ||
      lowerMessage.includes('not found')
    ) {
      return `Ensure the image model "${model}" exists and is available on OpenRouter`
    }
    return 'Check OpenRouter API configuration and try again'
  }
}

/**
 * Creates a new OpenRouter image client.
 */
export function createOpenRouterImageClient(config: Config): Result<ImageClient, ImageAPIError> {
  try {
    return Ok(new OpenRouterImageClientImpl(config))
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return Err(
      new ImageAPIError(
        `Failed to initialize OpenRouter image client: ${errorMessage}`,
        'Verify your OPENROUTER_API_KEY and OpenRouter model configuration'
      )
    )
  }
}
