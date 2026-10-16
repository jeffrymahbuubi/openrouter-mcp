#!/usr/bin/env node

/**
 * MCP Audio Generator - Entry Point Router
 *
 * Routes to:
 * - skills install  → bin/install-skills.js
 * - (default)       → MCP server startup
 */

// Load .env relative to this package (package .env first, then the repo-root
// .env). Already-set env vars are never overridden, so MCP-client-provided env
// config always wins.
import './utils/loadEnv.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const args = process.argv.slice(2)

if (args[0] === 'skills') {
  if (args[1] === 'install') {
    // `import()` requires a `file://` URL on Windows — a raw resolved path
    // (e.g. `D:\...`) throws ERR_UNSUPPORTED_ESM_URL_SCHEME there.
    const installerUrl = pathToFileURL(resolve(__dirname, '..', 'bin', 'install-skills.js'))
    const { run } = await import(installerUrl.href)
    run(args.slice(2))
    process.exit(0)
  } else {
    console.error(
      'Unknown skills subcommand. Usage: npx mcp-audio-openrouter skills install --path <path>'
    )
    console.error('Run "npx mcp-audio-openrouter skills install --help" for more information.')
    process.exit(1)
  }
} else {
  await import('./server-main.js')
}

export type { GeneratedMusicResult, GeneratedVoiceResult } from './api/audioClient.js'
export { createMCPServer, MCPServerImpl } from './server/mcpServer.js'
export type { GenerateMusicParams, GenerateVoiceParams, MCPServerConfig } from './types/mcp.js'
