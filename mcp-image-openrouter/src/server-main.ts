/**
 * MCP Image Generator - Server Entry Point
 */

// Load .env relative to this package, then the repo root (non-overriding;
// MCP-client env wins). Must stay the first import.
import './utils/loadEnv.js'
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { MCPServerImpl } from './server/mcpServer.js'
import { Logger } from './utils/logger.js'

// Windows happy-eyeballs: the default 250 ms attempt timeout makes dual-stack
// connects to openrouter.ai fail with ETIMEDOUT. Must run before any fetch.
setDefaultAutoSelectFamilyAttemptTimeout(500)

const logger = new Logger()

/**
 * Application startup
 */
async function main(): Promise<void> {
  try {
    logger.info('mcp-startup', 'Starting MCP Image Generator initialization', {
      nodeVersion: process.version,
      platform: process.platform,
      env: process.env['NODE_ENV'] || 'development',
    })

    const mcpServerImpl = new MCPServerImpl()

    const server = mcpServerImpl.initialize()

    const transport = new StdioServerTransport()

    await server.connect(transport)

    logger.info('mcp-startup', 'Image Generator MCP Server started successfully')
  } catch (error) {
    logger.error('mcp-startup', 'Failed to start MCP server', error as Error, {
      errorType: (error as Error)?.constructor?.name,
      stack: (error as Error)?.stack,
    })
    process.exit(1)
  }
}

// Run main function
main().catch((error) => {
  logger.error('mcp-startup', 'Fatal error during startup', error as Error)
  process.exit(1)
})
