/**
 * MCP Server implementation
 * Simplified architecture with direct Gemini integration
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  type ListToolsResult,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
// API clients
import type { ImageClient } from '../api/imageClient.js'
import { createOpenRouterImageClient } from '../api/openrouterImageClient.js'
import { createOpenRouterTextClient } from '../api/openrouterTextClient.js'
import type { TextClient } from '../api/textClient.js'
// Business logic
import { createFileManager, type FileManager } from '../business/fileManager.js'
import { applyDiagramPreset } from '../business/generationPresets.js'
import { validateGenerateImageParams } from '../business/inputValidator.js'
import {
  createResponseBuilder,
  type InlinePreview,
  type ResponseBuilder,
} from '../business/responseBuilder.js'
import {
  createStructuredPromptGenerator,
  type FeatureFlags,
  type StructuredPromptGenerator,
} from '../business/structuredPromptGenerator.js'
import { MODEL_GUIDE_MARKDOWN } from '../guide/modelGuide.js'
// Types
import type { GenerateImageParams, MCPServerConfig } from '../types/mcp.js'

// Utilities
import { getConfig } from '../utils/config.js'
import { Logger } from '../utils/logger.js'
import { ensureExtension, getMimeTypeFromExtension } from '../utils/mimeUtils.js'
import { SecurityManager } from '../utils/security.js'
import { analyzeImage } from '../utils/thumbnail.js'
import { ErrorHandler } from './errorHandler.js'
import {
  GENERATE_IMAGE_TOOL,
  GET_MODEL_GUIDE_TOOL,
  GUIDE_RESOURCE,
  GUIDE_RESOURCE_URI,
} from './toolDefinitions.js'

/**
 * Default MCP server configuration
 */
const DEFAULT_CONFIG: MCPServerConfig = {
  name: 'mcp-image-server',
  version: '0.1.0',
  defaultOutputDir: './output',
}

/**
 * Simplified MCP server
 */
export class MCPServerImpl {
  private config: MCPServerConfig
  private server: Server | null = null
  private logger: Logger
  private fileManager: FileManager
  private responseBuilder: ResponseBuilder
  private securityManager: SecurityManager
  private structuredPromptGenerator: StructuredPromptGenerator | null = null
  private textClient: TextClient | null = null
  private imageClient: ImageClient | null = null

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
  public getToolsList() {
    return { tools: [GENERATE_IMAGE_TOOL, GET_MODEL_GUIDE_TOOL] }
  }

  /**
   * Get list of registered resources
   */
  public listResources() {
    return { resources: [GUIDE_RESOURCE] }
  }

  /**
   * Read a registered resource; an unknown URI is a JSON-RPC invalid-params error.
   */
  public readResource(uri: string) {
    if (uri !== GUIDE_RESOURCE_URI) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource: ${uri}`)
    }
    return {
      contents: [{ uri, mimeType: GUIDE_RESOURCE.mimeType, text: MODEL_GUIDE_MARKDOWN }],
    }
  }

  /**
   * Tool execution
   */
  public async callTool(name: string, args: unknown) {
    try {
      if (name === 'generate_image') {
        return await this.handleGenerateImage(args as GenerateImageParams)
      }
      if (name === 'get_model_guide') {
        return { content: [{ type: 'text' as const, text: MODEL_GUIDE_MARKDOWN }], isError: false }
      }
      throw new Error(`Unknown tool: ${name}`)
    } catch (error) {
      this.logger.error('mcp-server', 'Tool execution failed', error as Error)
      return ErrorHandler.handleError(error as Error)
    }
  }

  /**
   * Initialize provider clients lazily.
   */
  private async initializeClients(): Promise<void> {
    const configResult = getConfig()
    if (!configResult.success) {
      throw configResult.error
    }
    const config = configResult.data

    if (this.imageClient && (config.skipPromptEnhancement || this.structuredPromptGenerator)) {
      return
    }

    // Initialize Text Client for prompt generation when enhancement is enabled.
    if (!config.skipPromptEnhancement && !this.textClient) {
      const textClientResult = createOpenRouterTextClient(config)
      if (!textClientResult.success) {
        throw textClientResult.error
      }
      this.textClient = textClientResult.data
    }

    // Initialize Structured Prompt Generator
    if (!config.skipPromptEnhancement && this.textClient && !this.structuredPromptGenerator) {
      this.structuredPromptGenerator = createStructuredPromptGenerator(this.textClient)
    }

    // Initialize image generation client.
    if (!this.imageClient) {
      const clientResult = createOpenRouterImageClient(config)
      if (!clientResult.success) {
        throw clientResult.error
      }
      this.imageClient = clientResult.data
    }

    this.logger.info('mcp-server', 'Image provider clients initialized', {
      provider: 'openrouter',
      promptEnhancement: !config.skipPromptEnhancement,
    })
  }

  /**
   * Simplified image generation handler
   */
  private async handleGenerateImage(params: GenerateImageParams) {
    const result = await ErrorHandler.wrapWithResultType(async () => {
      // Validate input
      const validationResult = validateGenerateImageParams(params)
      if (!validationResult.success) {
        throw validationResult.error
      }

      // Get configuration
      const configResult = getConfig()
      if (!configResult.success) {
        throw configResult.error
      }

      // Initialize clients
      await this.initializeClients()

      // Handle input image if provided
      let inputImageData: string | undefined
      let inputImageMimeType: string | undefined
      if (params.inputImagePath) {
        const sanitizedInputPath = this.securityManager.sanitizeInputFilePath(params.inputImagePath)
        if (!sanitizedInputPath.success) {
          throw sanitizedInputPath.error
        }
        const extensionCheck = this.securityManager.validateImageFile(sanitizedInputPath.data)
        if (!extensionCheck.success) {
          throw extensionCheck.error
        }
        const imageBuffer = await fs.readFile(sanitizedInputPath.data)
        inputImageData = imageBuffer.toString('base64')
        inputImageMimeType = getMimeTypeFromExtension(path.extname(sanitizedInputPath.data))
      }

      // The diagram preset sends the caller's prompt verbatim (text-exact figures).
      const preset = params.preset === 'diagram' ? applyDiagramPreset(params) : undefined
      const skipEnhancement = configResult.data.skipPromptEnhancement || preset !== undefined
      const quality = preset?.quality ?? params.quality
      const outputFormat = preset?.outputFormat ?? params.outputFormat

      // Generate structured prompt (unless skipped)
      let structuredPrompt = params.prompt
      if (!skipEnhancement && this.structuredPromptGenerator) {
        const features: FeatureFlags = {}
        if (params.maintainCharacterConsistency !== undefined) {
          features.maintainCharacterConsistency = params.maintainCharacterConsistency
        }
        if (params.blendImages !== undefined) {
          features.blendImages = params.blendImages
        }
        if (params.useWorldKnowledge !== undefined) {
          features.useWorldKnowledge = params.useWorldKnowledge
        }
        if (params.useGoogleSearch !== undefined) {
          features.useGoogleSearch = params.useGoogleSearch
        }

        const promptResult = await this.structuredPromptGenerator.generateStructuredPrompt(
          params.prompt,
          features,
          inputImageData,
          params.purpose,
          inputImageMimeType
        )

        if (promptResult.success) {
          structuredPrompt = promptResult.data.structuredPrompt

          this.logger.info('mcp-server', 'Structured prompt generated', {
            originalLength: params.prompt.length,
            structuredLength: structuredPrompt.length,
            selectedPractices: promptResult.data.selectedPractices,
          })
        } else {
          this.logger.warn('mcp-server', 'Using original prompt', {
            error: promptResult.error.message,
          })
        }
      } else if (skipEnhancement) {
        this.logger.info('mcp-server', 'Prompt enhancement skipped', {
          reason: preset ? 'preset diagram' : 'SKIP_PROMPT_ENHANCEMENT=true',
        })
      }

      // Generate image using selected provider.
      if (!this.imageClient) {
        throw new Error('Image client not initialized')
      }

      const generationResult = await this.imageClient.generateImage({
        prompt: structuredPrompt,
        ...(inputImageData && { inputImage: inputImageData }),
        ...(inputImageMimeType && { inputImageMimeType }),
        ...(params.aspectRatio && { aspectRatio: params.aspectRatio }),
        ...(params.imageSize && { imageSize: params.imageSize }),
        ...(params.useGoogleSearch !== undefined && { useGoogleSearch: params.useGoogleSearch }),
        ...(quality !== undefined && { quality }),
        ...(outputFormat !== undefined && {
          outputFormat,
          outputFormatExplicit: params.outputFormat !== undefined,
        }),
        ...(preset && { background: preset.background }),
      })

      if (!generationResult.success) {
        throw generationResult.error
      }

      // Save image file
      const mimeType = generationResult.data.metadata.mimeType
      const rawFileName = params.fileName
        ? this.securityManager.sanitizeFilename(params.fileName)
        : this.fileManager.generateFileName(mimeType)
      const fileName = params.fileName ? ensureExtension(rawFileName, mimeType) : rawFileName
      const outputPath = path.join(configResult.data.imageOutputDir, fileName)

      const sanitizedPath = this.securityManager.sanitizeFilePath(outputPath)
      if (!sanitizedPath.success) {
        throw sanitizedPath.error
      }

      const saveResult = await this.fileManager.saveImage(
        generationResult.data.imageData,
        sanitizedPath.data
      )
      if (!saveResult.success) {
        throw saveResult.error
      }

      // Best-effort: one decode yields the delivered pixel size and, when
      // enabled, an inline preview so MCP clients can render the image. The
      // full-resolution file on disk is unaffected if this fails.
      let preview: InlinePreview | undefined
      let delivered = generationResult.data
      const analysis = await analyzeImage(generationResult.data.imageData, {
        withPreview: configResult.data.inlinePreview,
      })
      if (analysis.success) {
        preview = analysis.data.preview
        delivered = {
          ...generationResult.data,
          metadata: {
            ...generationResult.data.metadata,
            width: analysis.data.width,
            height: analysis.data.height,
          },
        }
      } else {
        this.logger.warn('mcp-server', 'Image analysis failed; returning path only', {
          error: analysis.error.message,
        })
      }

      // Build response
      return this.responseBuilder.buildSuccessResponse(delivered, saveResult.data, preview)
    }, 'image-generation')

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
          resources: {},
        },
      }
    )

    // Setup tool handlers
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

    // Register tool list handler
    this.server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
      return this.getToolsList()
    })

    // Register resource handlers (the bundled model guide)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => this.listResources())
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
      this.readResource(request.params.uri)
    )

    // Register tool call handler
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
