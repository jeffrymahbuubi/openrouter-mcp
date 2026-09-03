/**
 * Smoke tests for the MCP server surface (provider-neutral).
 *
 * The full generate_image flow is covered once the OpenRouter clients are
 * implemented (Phase 6, with the clients mocked). Here we assert the static
 * server metadata and tool schema, which do not require any provider.
 */

import { describe, expect, it } from 'vitest'
import { createMCPServer, MCPServerImpl } from '../mcpServer'

describe('MCPServerImpl', () => {
  it('exposes server info', () => {
    const server = new MCPServerImpl({ name: 'test-server', version: '9.9.9' })
    expect(server.getServerInfo()).toEqual({ name: 'test-server', version: '9.9.9' })
  })

  it('createMCPServer returns an instance', () => {
    expect(createMCPServer()).toBeInstanceOf(MCPServerImpl)
  })

  it('lists the generate_image tool with a prompt-required schema', () => {
    const server = createMCPServer()
    const { tools } = server.getToolsList()

    expect(tools).toHaveLength(1)
    const tool = tools[0]
    expect(tool?.name).toBe('generate_image')
    expect(tool?.inputSchema.required).toContain('prompt')
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['prompt', 'inputImagePath', 'aspectRatio', 'imageSize', 'quality'])
    )
  })

  it('advertises the documented aspect-ratio and quality enums', () => {
    const server = createMCPServer()
    const props = server.getToolsList().tools[0]?.inputSchema.properties as Record<
      string,
      { enum?: string[] }
    >
    expect(props.quality?.enum).toEqual(['fast', 'balanced', 'quality'])
    expect(props.imageSize?.enum).toEqual(['1K', '2K', '4K'])
    expect(props.aspectRatio?.enum).toContain('16:9')
  })
})
