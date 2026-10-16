import type { AspectRatio, ImageQuality, ImageSize, OutputFormat } from '../types/mcp.js'
import type { Result } from '../types/result.js'
import type { GeminiAPIError, ImageAPIError, NetworkError, TimeoutError } from '../utils/errors.js'

/**
 * Aspect ratio and size as requested by the caller, or as actually delivered
 * to the provider. `null` means not requested / dropped / folded into the prompt.
 */
export interface ParameterReport {
  aspectRatio: string | null
  imageSize: string | null
}

/**
 * Provider-neutral metadata for generated images.
 */
interface ImageGenerationMetadata {
  model: string
  prompt: string
  mimeType: string
  timestamp: Date
  inputImageProvided: boolean
  provider?: string
  modelVersion?: string
  responseId?: string
  revisedPrompt?: string
  /** Wall-clock request duration in ms (fetch plus body decode). */
  durationMs: number
  /** Delivered pixel size; stamped by the server after decoding the image. */
  width?: number
  height?: number
  requested: ParameterReport
  delivered: ParameterReport
  /** Human-readable notes on every mapped, dropped or folded parameter. */
  warnings: string[]
}

/**
 * Provider-neutral image generation/editing parameters.
 */
export interface ImageApiParams {
  prompt: string
  inputImage?: string
  inputImageMimeType?: string
  aspectRatio?: AspectRatio
  imageSize?: ImageSize
  useGoogleSearch?: boolean
  quality?: ImageQuality
  /** Requested file format; sent as `output_format` only when the model accepts it. */
  outputFormat?: OutputFormat
  /** True only when the caller (not a preset default) supplied `outputFormat`. */
  outputFormatExplicit?: boolean
  /** Requested background; sent natively when supported, else a prompt hint. */
  background?: 'opaque'
  /** Test-only override of the OpenRouter `quality` value on the quality tier. */
  openrouterQuality?: 'low' | 'medium' | 'high'
}

/**
 * Result of image generation.
 */
export interface GeneratedImageResult {
  imageData: Buffer
  metadata: ImageGenerationMetadata
}

/**
 * Provider-neutral image client.
 */
export interface ImageClient {
  generateImage(
    params: ImageApiParams
  ): Promise<
    Result<GeneratedImageResult, GeminiAPIError | ImageAPIError | NetworkError | TimeoutError>
  >
}
