/**
 * Pure request-parameter mapping for the Images API.
 *
 * Given the caller's parameters and the model's capabilities, decides per
 * parameter whether to send it natively, map it to the nearest native value,
 * fold it into the prompt (aspect only, where composition is expressible in
 * text) or drop it (resolution is never folded: providers ignore size prose).
 * Every non-native outcome produces a warning ending with a pointer to the
 * `get_model_guide` tool, and requested vs delivered values are reported.
 */

import type { ImageApiParams, ParameterReport } from './imageClient.js'
import type { ModelCapabilities } from './modelCapabilities.js'

const GUIDE_POINTER = 'Call get_model_guide to choose a model that supports this.'

/** Pixel classes in ascending order, used to find the nearest listed resolution. */
const RESOLUTION_ORDER = ['512', '768', '1K', '1.5K', '2K', '4K']

const RATIO_PATTERN = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/

const WHITE_BACKGROUND_HINT = '\n\nBackground: use a plain, solid white background.'

export interface MappedParameters {
  aspect_ratio?: string
  resolution?: string
  quality?: string
  output_format?: string
  background?: string
  /** Text appended to the prompt (folded aspect, white-background hint). */
  promptSuffix: string
  requested: ParameterReport
  delivered: ParameterReport
  warnings: string[]
}

function logRatio(token: string): number | null {
  const match = RATIO_PATTERN.exec(token)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  return width > 0 && height > 0 ? Math.log(width / height) : null
}

/** Nearest ratio by `|ln(w/h)|` distance; non-ratio tokens such as `auto` are skipped. */
function nearestAspect(requested: string, candidates: string[]): string | null {
  const target = logRatio(requested)
  if (target === null) return null
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of candidates) {
    const value = logRatio(candidate)
    if (value === null) continue
    const distance = Math.abs(target - value)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/** Nearest listed pixel class; ties keep the earlier (smaller, cheaper) candidate. */
function nearestResolution(requested: string, candidates: string[]): string | null {
  const target = RESOLUTION_ORDER.indexOf(requested)
  if (target < 0) return null
  let best: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  const ranked = candidates
    .map((candidate) => ({ candidate, rank: RESOLUTION_ORDER.indexOf(candidate) }))
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
  for (const { candidate, rank } of ranked) {
    const distance = Math.abs(target - rank)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

export function mapParameters(params: ImageApiParams, caps: ModelCapabilities): MappedParameters {
  const mapped: MappedParameters = {
    promptSuffix: '',
    requested: {
      aspectRatio: params.aspectRatio ?? null,
      imageSize: params.imageSize ?? null,
    },
    delivered: { aspectRatio: null, imageSize: null },
    warnings: [],
  }
  const warn = (message: string) => mapped.warnings.push(`${message} ${GUIDE_POINTER}`)

  if (params.aspectRatio) {
    const asked = params.aspectRatio
    const list = caps.aspectRatios
    if (list?.includes(asked)) {
      mapped.aspect_ratio = asked
      mapped.delivered.aspectRatio = asked
    } else {
      const nearest = list ? nearestAspect(asked, list) : null
      if (nearest) {
        mapped.aspect_ratio = nearest
        mapped.delivered.aspectRatio = nearest
        warn(
          `aspectRatio ${asked} is not supported by this model (supports ${list?.join(', ')}); sent nearest ${nearest} instead.`
        )
      } else {
        mapped.promptSuffix += `\n\nComposition: frame the image with a strict ${asked} aspect ratio.`
        warn(
          `aspectRatio ${asked} requested but this model has no aspect parameter; folded into the prompt as a composition hint, so the delivered aspect is not guaranteed.`
        )
      }
    }
  }

  if (params.imageSize) {
    const asked = params.imageSize
    const list = caps.resolutions
    if (list?.includes(asked)) {
      mapped.resolution = asked
      mapped.delivered.imageSize = asked
    } else {
      const nearest = list ? nearestResolution(asked, list) : null
      if (nearest) {
        mapped.resolution = nearest
        mapped.delivered.imageSize = nearest
        warn(
          `imageSize ${asked} is not supported by this model (supports ${list?.join(', ')}); sent nearest ${nearest} instead.`
        )
      } else {
        warn(
          `imageSize ${asked} requested but this model has no resolution parameter; dropped, so the output size is whatever the model produces.`
        )
      }
    }
  }

  if (params.quality === 'quality' && caps.quality) {
    mapped.quality = params.openrouterQuality ?? 'high'
  }

  if (params.outputFormat) {
    if (caps.outputFormats?.includes(params.outputFormat)) {
      mapped.output_format = params.outputFormat
    } else if (params.outputFormatExplicit) {
      warn(
        `outputFormat ${params.outputFormat} requested but this model does not accept it${
          caps.outputFormats
            ? ` (accepts ${caps.outputFormats.join(', ')})`
            : ' (no output_format parameter)'
        }; the model decides the format.`
      )
    }
  }

  if (params.background) {
    if (caps.background) {
      mapped.background = params.background
    } else {
      mapped.promptSuffix += WHITE_BACKGROUND_HINT
      warn(
        `background ${params.background} requested but this model has no background parameter; dropped and a white-background hint was added to the prompt.`
      )
    }
  }

  return mapped
}
