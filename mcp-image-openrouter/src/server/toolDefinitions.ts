/**
 * MCP tool and resource schema literals for the image server, kept apart from
 * the server wiring in `mcpServer.ts`.
 */

import { MODEL_GUIDE_SUMMARY } from '../guide/modelGuide.js'

export const GUIDE_RESOURCE_URI = 'guide://image-models'

export const GENERATE_IMAGE_TOOL = {
  name: 'generate_image',
  description: `Generate image with specified prompt and optional parameters. Model guidance: ${MODEL_GUIDE_SUMMARY} Use preset "diagram" for text-exact figures.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      prompt: {
        type: 'string' as const,
        description:
          'The prompt for image generation (English recommended for optimal structured prompt enhancement)',
      },
      fileName: {
        type: 'string' as const,
        description: 'Custom file name for the output image. Auto-generated if not specified.',
      },
      inputImagePath: {
        type: 'string' as const,
        description:
          'Optional absolute path to source image for image-to-image generation. Use when generating variations, style transfers, or similar images based on an existing image (must be an absolute path)',
      },
      blendImages: {
        type: 'boolean' as const,
        description:
          'Enable multi-image blending for combining multiple visual elements naturally. Use when prompt mentions multiple subjects or composite scenes',
      },
      maintainCharacterConsistency: {
        type: 'boolean' as const,
        description:
          'Maintain character appearance consistency. Enable when generating same character in different poses/scenes',
      },
      useWorldKnowledge: {
        type: 'boolean' as const,
        description:
          'Use real-world knowledge for accurate context. Enable for historical figures, landmarks, or factual scenarios',
      },
      useGoogleSearch: {
        type: 'boolean' as const,
        description:
          "Enable Google Search grounding to access real-time web information for factually accurate image generation. Use when prompt requires current or time-sensitive data that may have changed since the model's knowledge cutoff. Leave disabled for creative, fictional, historical, or timeless content.",
      },
      aspectRatio: {
        type: 'string' as const,
        description: 'Aspect ratio for the generated image',
        enum: [
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
        ],
      },
      imageSize: {
        type: 'string' as const,
        description:
          'Image resolution for high-quality output. Specify "1K", "2K", or "4K" when you need specific resolution. Leave unspecified for standard quality.',
        enum: ['1K', '2K', '4K'],
      },
      purpose: {
        type: 'string' as const,
        description:
          'Intended use for the image (e.g., cookbook cover, social media post, presentation slide). Influences lighting, composition, and detail level to match the context.',
      },
      quality: {
        type: 'string' as const,
        description:
          'Quality preset controlling speed/fidelity tradeoff. Only specify when the user explicitly requests a specific quality level; omit to use the server\'s configured default. "fast": best for drafts and rapid iteration. "balanced": better detail and coherence, moderate latency. "quality": highest fidelity, use for final deliverables where quality matters most.',
        enum: ['fast', 'balanced', 'quality'],
      },
      outputFormat: {
        type: 'string' as const,
        description:
          'Output file format. PNG is lossless; JPEG and WebP add compression artefacts that blur small text. Sent only when the selected model accepts an output format; otherwise the model decides and the result carries a warning.',
        enum: ['png', 'jpeg', 'webp'],
      },
      preset: {
        type: 'string' as const,
        description:
          'Named preset. "diagram": for text-exact figures (flowcharts, slides, labelled diagrams). Sends your prompt verbatim (no prompt enhancement), defaults quality to "quality", and requests a PNG with an opaque background where the model supports them. An explicit quality or outputFormat still wins.',
        enum: ['diagram'],
      },
    },
    required: ['prompt'],
  },
}

export const GET_MODEL_GUIDE_TOOL = {
  name: 'get_model_guide',
  description:
    'Returns the bundled guide to OpenRouter image models: which model suits which task (text-exact diagrams, posters, slides, photoreal, vector, editing, CJK), supported parameters, cost, timing and prompting tips. Call it before choosing a model or when a generate_image result carries warnings.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
  },
}

export const GUIDE_RESOURCE = {
  uri: GUIDE_RESOURCE_URI,
  name: 'Image model guide',
  description: 'Which OpenRouter image model for which task, parameters, cost and prompting tips',
  mimeType: 'text/markdown',
}
