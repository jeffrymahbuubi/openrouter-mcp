/**
 * OpenRouter image client for Stage-2 generation / editing.
 *
 * Uses OpenRouter's dedicated Images API via a raw `fetch` POST to
 * `{baseUrl}/images` (decision (c): the OpenAI SDK's images.generate() targets
 * a different path). Verified contract: docs/OPENROUTER_API.md §3 —
 * request `{model,prompt,n,aspect_ratio?,resolution?,input_references?}`,
 * response `{data:[{b64_json,media_type?}]}` (raw base64).
 */

import type { ImageQuality, ImageSize } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import type { Config } from '../utils/config.js'
import { ImageAPIError, NetworkError } from '../utils/errors.js'
import { DEFAULT_MIME_TYPE, normalizeMimeType } from '../utils/mimeUtils.js'
import { isNetworkError } from './errorClassification.js'
import type { GeneratedImageResult, ImageApiParams, ImageClient } from './imageClient.js'

/**
 * Native-parameter support per image model, from the verified
 * `GET /api/v1/images/models` capability records (2026-07-11). Models absent
 * from this map are treated conservatively (no native params → prompt folding).
 */
interface ModelCapabilities {
  aspectRatio: boolean
  resolution: boolean
}

const MODEL_CAPABILITIES: Readonly<Record<string, ModelCapabilities>> = {
  'google/gemini-2.5-flash-image': { aspectRatio: true, resolution: false },
  'google/gemini-3.1-flash-lite-image': { aspectRatio: true, resolution: true },
  'google/gemini-3.1-flash-image': { aspectRatio: true, resolution: true },
  'google/gemini-3.1-flash-image-preview': { aspectRatio: true, resolution: true },
  'google/gemini-3-pro-image': { aspectRatio: true, resolution: true },
  'google/gemini-3-pro-image-preview': { aspectRatio: true, resolution: true },
}

const DEFAULT_CAPABILITIES: ModelCapabilities = { aspectRatio: false, resolution: false }

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
  resolution?: ImageSize
  input_references?: Array<{ type: 'image_url'; image_url: { url: string } }>
}

class OpenRouterImageClientImpl implements ImageClient {
  constructor(private readonly config: Config) {}

  async generateImage(
    params: ImageApiParams
  ): Promise<Result<GeneratedImageResult, ImageAPIError | NetworkError>> {
    const model = this.selectModel(params.quality ?? this.config.imageQuality)
    const caps = MODEL_CAPABILITIES[model] ?? DEFAULT_CAPABILITIES

    const request = this.buildRequest(params, model, caps)

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
        signal: AbortSignal.timeout(this.config.apiTimeout),
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

    return Ok({
      imageData: Buffer.from(image.b64_json, 'base64'),
      metadata: {
        model,
        provider: 'openrouter',
        prompt: params.prompt,
        mimeType,
        timestamp: new Date(),
        inputImageProvided: !!params.inputImage,
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
    caps: ModelCapabilities
  ): ImagesApiRequest {
    let prompt = params.prompt

    const request: ImagesApiRequest = { model, prompt, n: 1 }

    // Aspect ratio: native when supported, otherwise fold into the prompt (D4).
    if (params.aspectRatio) {
      if (caps.aspectRatio) {
        request.aspect_ratio = params.aspectRatio
      } else {
        prompt += `\n\nComposition: frame the image with a strict ${params.aspectRatio} aspect ratio.`
      }
    }

    // Image size: native `resolution` when supported, otherwise fold (D4).
    if (params.imageSize) {
      if (caps.resolution) {
        request.resolution = params.imageSize
      } else {
        prompt += `\n\nRender at high resolution (~${params.imageSize}), with crisp fine detail and sharp text.`
      }
    }

    // useGoogleSearch: no real-time grounding on OpenRouter image models — soft
    // hint only, never a hard error (D4).

    if (params.inputImage) {
      const mimeType = normalizeMimeType(params.inputImageMimeType ?? DEFAULT_MIME_TYPE)
      request.input_references = [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${params.inputImage}` } },
      ]
    }

    request.prompt = prompt
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

  private handleThrownError(error: unknown): Result<never, ImageAPIError | NetworkError> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const name = error instanceof Error ? error.name : ''

    // `fetch` throws TypeError on transport failure and TimeoutError/AbortError
    // on an aborted request — all network-class failures.
    if (
      isNetworkError(error) ||
      error instanceof TypeError ||
      name === 'TimeoutError' ||
      name === 'AbortError'
    ) {
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
