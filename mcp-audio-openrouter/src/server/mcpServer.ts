/**
 * MCP Server implementation
 * Exposes `generate_voice` (GPT Audio) and `generate_music` (Lyria 3) tools,
 * both backed by a single shared `AudioClient` (see docs/SPEC.md D2).
 */

import * as path from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
// API client
import type { AudioClient } from '../api/audioClient.js'
import { createOpenRouterAudioClient } from '../api/openrouterAudioClient.js'
// Business logic
import { createFileManager, type FileManager } from '../business/fileManager.js'
import {
  validateGenerateMusicParams,
  validateGenerateVoiceParams,
} from '../business/inputValidator.js'
import { createResponseBuilder, type ResponseBuilder } from '../business/responseBuilder.js'
// Types
import {
  AUDIO_FORMAT_VALUES,
  type GenerateMusicParams,
  type GenerateVoiceParams,
  type MCPServerConfig,
  MUSIC_LENGTH_VALUES,
  VOICE_VALUES,
} from '../types/mcp.js'
// Utilities
import { getConfig } from '../utils/config.js'
import { Logger } from '../utils/logger.js'
import { ensureExtension } from '../utils/mimeUtils.js'
import { SecurityManager } from '../utils/security.js'
import { ErrorHandler } from './errorHandler.js'

/**
 * Default MCP server configuration
 */
const DEFAULT_CONFIG: MCPServerConfig = {
  name: 'mcp-audio-server',
  version: '0.1.0',
  defaultOutputDir: './output',
}

/**
 * MCP server exposing OpenRouter-backed audio generation tools
 */
export class MCPServerImpl {
  private config: MCPServerConfig
  private server: Server | null = null
  private logger: Logger
  private fileManager: FileManager
  private responseBuilder: ResponseBuilder
  private securityManager: SecurityManager
  private audioClient: AudioClient | null = null

  constructor(config: Partial<MCPServerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.logger = new Logger()
    this.fileManager = createFileManager()
    this.responseBuilder = createResponseBuilder()
    this.securityManager = new SecurityManager()
  }

  /**
   * Get server info
   */
  public getServerInfo() {
    return {
      name: this.config.name,
      version: this.config.version,
    }
  }

  /**
   * Get list of registered tools
   */
  public getToolsList(): ListToolsResult {
    return {
      tools: [
        {
          name: 'generate_voice',
          description:
            'Generate spoken voice/dialogue audio from a text prompt or script, with tone/delivery instructions',
          inputSchema: {
            type: 'object' as const,
            properties: {
              prompt: {
                type: 'string' as const,
                description:
                  "The text to speak, optionally with delivery/emotion/pacing instructions (e.g. 'Say in a warm, slow, reassuring tone: ...')",
              },
              fileName: {
                type: 'string' as const,
                description:
                  'Custom file name for the output audio. Auto-generated if not specified.',
              },
              voice: {
                type: 'string' as const,
                description: 'Voice preset for speech synthesis',
                enum: [...VOICE_VALUES],
              },
              format: {
                type: 'string' as const,
                description:
                  "Output audio container/codec. Currently always produces WAV regardless of this setting — OpenRouter's streaming voice endpoint only returns raw PCM, which is wrapped in a WAV container; mp3 is accepted for schema symmetry with generate_music but not yet honored.",
                enum: [...AUDIO_FORMAT_VALUES],
              },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'generate_music',
          description:
            'Generate instrumental background music/score from a text description (genre, mood, instrumentation, tempo)',
          inputSchema: {
            type: 'object' as const,
            properties: {
              prompt: {
                type: 'string' as const,
                description:
                  'Description of the desired music: genre, mood, instrumentation, tempo, and structure (English recommended)',
              },
              fileName: {
                type: 'string' as const,
                description:
                  'Custom file name for the output audio. Auto-generated if not specified.',
              },
              length: {
                type: 'string' as const,
                description:
                  'Track length preset. "clip": ~30 second clip (fast, cheap). "long": up to a couple of minutes (slower, more expensive). Default "clip".',
                enum: [...MUSIC_LENGTH_VALUES],
              },
              format: {
                type: 'string' as const,
                description:
                  "Requested output audio container/codec. The actual returned format is auto-detected from the response and used for the saved file's extension/mime type, since the provider does not always honor this request exactly.",
                enum: [...AUDIO_FORMAT_VALUES],
              },
            },
            required: ['prompt'],
          },
        },
      ],
    }
  }

  /**
   * Tool execution
   */
  public async callTool(
    name: string,
    args: unknown
  ): Promise<import('../types/mcp.js').McpToolResponse> {
    try {
      if (name === 'generate_voice') {
        return await this.handleGenerateVoice(args as GenerateVoiceParams)
      }
      if (name === 'generate_music') {
        return await this.handleGenerateMusic(args as GenerateMusicParams)
      }
      throw new Error(`Unknown tool: ${name}`)
    } catch (error) {
      this.logger.error('mcp-server', 'Tool execution failed', error as Error)
      return ErrorHandler.handleError(error as Error)
    }
  }

  /**
   * Initialize the OpenRouter audio client lazily.
   */
  private async initializeClient(): Promise<void> {
    if (this.audioClient) {
      return
    }

    const configResult = getConfig()
    if (!configResult.success) {
      throw configResult.error
    }

    const clientResult = createOpenRouterAudioClient(configResult.data)
    if (!clientResult.success) {
      throw clientResult.error
    }
    this.audioClient = clientResult.data

    this.logger.info('mcp-server', 'Audio provider client initialized', {
      provider: 'openrouter',
    })
  }

  /**
   * `generate_voice` handler: validate → configure → generate → save → respond.
   */
  private async handleGenerateVoice(params: GenerateVoiceParams) {
    const result = await ErrorHandler.wrapWithResultType(async () => {
      const validationResult = validateGenerateVoiceParams(params)
      if (!validationResult.success) {
        throw validationResult.error
      }

      const configResult = getConfig()
      if (!configResult.success) {
        throw configResult.error
      }

      await this.initializeClient()
      if (!this.audioClient) {
        throw new Error('Audio client not initialized')
      }

      const voice = params.voice ?? configResult.data.defaultVoice
      const format = params.format ?? configResult.data.defaultAudioFormat

      const generationResult = await this.audioClient.generateVoice({
        prompt: params.prompt,
        voice,
        format,
      })

      if (!generationResult.success) {
        throw generationResult.error
      }

      const mimeType = generationResult.data.metadata.mimeType
      const rawFileName = params.fileName
        ? this.securityManager.sanitizeFilename(params.fileName)
        : this.fileManager.generateFileName('voice', mimeType)
      const fileName = params.fileName ? ensureExtension(rawFileName, mimeType) : rawFileName
      const outputPath = path.join(configResult.data.audioOutputDir, fileName)

      const sanitizedPath = this.securityManager.sanitizeFilePath(outputPath)
      if (!sanitizedPath.success) {
        throw sanitizedPath.error
      }

      const saveResult = await this.fileManager.saveAudio(
        generationResult.data.audioData,
        sanitizedPath.data
      )
      if (!saveResult.success) {
        throw saveResult.error
      }

      return this.responseBuilder.buildVoiceSuccessResponse(generationResult.data, saveResult.data)
    }, 'voice-generation')

    if (result.ok) {
      return result.value
    }

    return this.responseBuilder.buildErrorResponse(result.error)
  }

  /**
   * `generate_music` handler: validate → configure → generate → save → respond.
   */
  private async handleGenerateMusic(params: GenerateMusicParams) {
    const result = await ErrorHandler.wrapWithResultType(async () => {
      const validationResult = validateGenerateMusicParams(params)
      if (!validationResult.success) {
        throw validationResult.error
      }

      const configResult = getConfig()
      if (!configResult.success) {
        throw configResult.error
      }

      await this.initializeClient()
      if (!this.audioClient) {
        throw new Error('Audio client not initialized')
      }

      const length = params.length ?? 'clip'
      const format = params.format ?? configResult.data.defaultAudioFormat

      const generationResult = await this.audioClient.generateMusic({
        prompt: params.prompt,
        length,
        format,
      })

      if (!generationResult.success) {
        throw generationResult.error
      }

      const mimeType = generationResult.data.metadata.mimeType
      const rawFileName = params.fileName
        ? this.securityManager.sanitizeFilename(params.fileName)
        : this.fileManager.generateFileName('music', mimeType)
      const fileName = params.fileName ? ensureExtension(rawFileName, mimeType) : rawFileName
      const outputPath = path.join(configResult.data.audioOutputDir, fileName)

      const sanitizedPath = this.securityManager.sanitizeFilePath(outputPath)
      if (!sanitizedPath.success) {
        throw sanitizedPath.error
      }

      const saveResult = await this.fileManager.saveAudio(
        generationResult.data.audioData,
        sanitizedPath.data
      )
      if (!saveResult.success) {
        throw saveResult.error
      }

      return this.responseBuilder.buildMusicSuccessResponse(generationResult.data, saveResult.data)
    }, 'music-generation')

    if (result.ok) {
      return result.value
    }

    return this.responseBuilder.buildErrorResponse(result.error)
  }

  /**
   * Initialize MCP server with tool handlers
   */
  public initialize(): Server {
    this.server = new Server(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    )

    this.setupHandlers()

    return this.server
  }

  /**
   * Setup MCP protocol handlers
   */
  private setupHandlers(): void {
    if (!this.server) {
      throw new Error('Server not initialized')
    }

    this.server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
      return this.getToolsList()
    })

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request): Promise<CallToolResult> => {
        const { name, arguments: args } = request.params
        const result = await this.callTool(name, args)
        const response: CallToolResult = {
          content: result.content,
        }
        if (result.structuredContent) {
          response.structuredContent = result.structuredContent as { [x: string]: unknown }
        }
        return response
      }
    )
  }
}

/**
 * Factory function to create MCP server
 */
export function createMCPServer(config: Partial<MCPServerConfig> = {}) {
  return new MCPServerImpl(config)
}
