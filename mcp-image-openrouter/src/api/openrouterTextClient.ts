/**
 * OpenRouter text client for Stage-1 structured prompt enhancement.
 *
 * Uses the OpenAI SDK pointed at OpenRouter's OpenAI-compatible endpoint
 * (`chat.completions.create`). The enhanced prompt is read from
 * `choices[0].message.content`. See docs/OPENROUTER_API.md §1–2.
 */

import OpenAI from 'openai'
import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import type { Result } from '../types/result.js'
import { Err, Ok } from '../types/result.js'
import type { Config } from '../utils/config.js'
import { ImageAPIError, NetworkError } from '../utils/errors.js'
import { DEFAULT_MIME_TYPE, normalizeMimeType } from '../utils/mimeUtils.js'
import { extractStatusCode, isNetworkError } from './errorClassification.js'
import type { GenerationConfig, TextClient } from './textClient.js'

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>
}

const MAX_PROMPT_LENGTH = 100000

class OpenRouterTextClientImpl implements TextClient {
  constructor(
    private readonly client: OpenAI,
    private readonly config: Config
  ) {}

  async generateText(
    prompt: string,
    config: GenerationConfig = {}
  ): Promise<Result<string, ImageAPIError | NetworkError>> {
    const validation = this.validatePromptInput(prompt)
    if (!validation.success) {
      return validation
    }

    const timeout = config.timeout ?? this.config.apiTimeout

    try {
      const response = (await this.client.chat.completions.create(
        {
          model: this.config.textModel,
          messages: this.buildMessages(prompt, config),
          temperature: config.temperature ?? 0.7,
          max_tokens: config.maxTokens ?? 8192,
          top_p: config.topP ?? 0.95,
        },
        { signal: AbortSignal.timeout(timeout) }
      )) as ChatCompletionResponse

      const content = response.choices?.[0]?.message?.content
      if (!content || content.trim().length === 0) {
        return Err(
          new ImageAPIError('Empty or blocked response from OpenRouter text API', {
            provider: 'openrouter',
            model: this.config.textModel,
            stage: 'text_extraction',
            suggestion:
              'Retry the request; if it persists the prompt may have been blocked or the model returned no text',
          })
        )
      }

      return Ok(content.trim())
    } catch (error) {
      return this.handleError(error, 'text generation')
    }
  }

  async validateConnection(): Promise<Result<boolean, ImageAPIError | NetworkError>> {
    // The OpenAI-compatible client is constructed eagerly; a successful
    // construction is sufficient to consider the connection configured.
    if (!this.client.chat?.completions) {
      return Err(
        new ImageAPIError(
          'Failed to access OpenRouter chat completions API',
          'Check your OPENROUTER_API_KEY and OPENROUTER_BASE_URL configuration'
        )
      )
    }
    return Ok(true)
  }

  private buildMessages(prompt: string, config: GenerationConfig): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = []

    if (config.systemInstruction) {
      messages.push({ role: 'system', content: config.systemInstruction })
    }

    if (config.inputImage) {
      const mimeType = normalizeMimeType(config.inputImageMimeType ?? DEFAULT_MIME_TYPE)
      const parts: ChatCompletionContentPart[] = [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${config.inputImage}` } },
      ]
      messages.push({ role: 'user', content: parts })
    } else {
      messages.push({ role: 'user', content: prompt })
    }

    return messages
  }

  private validatePromptInput(prompt: string): Result<true, ImageAPIError> {
    if (!prompt || prompt.trim().length === 0) {
      return Err(new ImageAPIError('Empty prompt provided', 'Please provide a non-empty prompt'))
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return Err(new ImageAPIError('Prompt too long', 'Please provide a shorter prompt'))
    }
    return Ok(true)
  }

  private handleError(
    error: unknown,
    context: string
  ): Result<never, ImageAPIError | NetworkError> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    if (isNetworkError(error)) {
      return Err(
        new NetworkError(
          `Network error during OpenRouter ${context}`,
          'Check your internet connection and try again'
        )
      )
    }

    return Err(
      new ImageAPIError(
        `Failed during OpenRouter ${context}`,
        {
          provider: 'openrouter',
          model: this.config.textModel,
          stage: context,
          upstreamMessage: errorMessage,
          suggestion: this.getAPIErrorSuggestion(errorMessage),
        },
        extractStatusCode(error)
      )
    )
  }

  private getAPIErrorSuggestion(errorMessage: string): string {
    const lowerMessage = errorMessage.toLowerCase()

    if (lowerMessage.includes('quota') || lowerMessage.includes('rate limit')) {
      return 'You have exceeded your OpenRouter quota or rate limit. Wait before retrying or add credits'
    }
    if (lowerMessage.includes('unauthorized') || lowerMessage.includes('api key')) {
      return 'Check that your OPENROUTER_API_KEY is valid'
    }
    if (lowerMessage.includes('model') || lowerMessage.includes('not found')) {
      return `Ensure the text model "${this.config.textModel}" exists and is available on OpenRouter`
    }
    return 'Check OpenRouter API configuration and try again'
  }
}

/**
 * Creates a new OpenRouter text client for prompt enhancement.
 */
export function createOpenRouterTextClient(config: Config): Result<TextClient, ImageAPIError> {
  try {
    const client = new OpenAI({
      apiKey: config.openrouterApiKey,
      baseURL: config.baseUrl,
      defaultHeaders: {
        ...(config.appUrl && { 'HTTP-Referer': config.appUrl }),
        ...(config.appTitle && { 'X-Title': config.appTitle }),
      },
    })
    return Ok(new OpenRouterTextClientImpl(client, config))
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return Err(
      new ImageAPIError(
        `Failed to initialize OpenRouter text client: ${errorMessage}`,
        'Verify your OPENROUTER_API_KEY is valid and the openai package is properly installed'
      )
    )
  }
}
