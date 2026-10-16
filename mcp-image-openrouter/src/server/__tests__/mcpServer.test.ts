/**
 * Smoke tests for the MCP server surface (provider-neutral).
 *
 * The full generate_image flow is covered once the OpenRouter clients are
 * implemented (Phase 6, with the clients mocked). Here we assert the static
 * server metadata and tool schema, which do not require any provider.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { MODEL_GUIDE_MARKDOWN } from '../../guide/modelGuide'
import { createMCPServer, MCPServerImpl } from '../mcpServer'

describe('MCPServerImpl', () => {
  it('exposes server info', () => {
    const server = new MCPServerImpl({ name: 'test-server', version: '9.9.9' })
    expect(server.getServerInfo()).toEqual({ name: 'test-server', version: '9.9.9' })
  })

  it('createMCPServer returns an instance', () => {
    expect(createMCPServer()).toBeInstanceOf(MCPServerImpl)
  })

  it('lists generate_image (prompt required) and get_model_guide', () => {
    const server = createMCPServer()
    const { tools } = server.getToolsList()

    expect(tools.map((t) => t.name)).toEqual(['generate_image', 'get_model_guide'])
    const tool = tools[0]
    expect(tool?.name).toBe('generate_image')
    expect(tool?.inputSchema.required).toContain('prompt')
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['prompt', 'inputImagePath', 'aspectRatio', 'imageSize', 'quality'])
    )
  })

  it('advertises the outputFormat and preset parameters', () => {
    const server = createMCPServer()
    const props = server.getToolsList().tools[0]?.inputSchema.properties as Record<
      string,
      { enum?: string[]; description?: string }
    >
    expect(props.outputFormat?.enum).toEqual(['png', 'jpeg', 'webp'])
    expect(props.outputFormat?.description).toMatch(/artefact/i)
    expect(props.preset?.enum).toEqual(['diagram'])
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

  it('points generate_image callers at get_model_guide and the diagram preset', () => {
    const description = createMCPServer().getToolsList().tools[0]?.description ?? ''

    expect(description).toContain('get_model_guide')
    expect(description).toContain('preset')
  })

  it('returns the guide markdown from get_model_guide', async () => {
    const result = await createMCPServer().callTool('get_model_guide', {})

    expect(result.isError).toBeFalsy()
    const block = result.content[0] as { type: string; text: string }
    expect(block.type).toBe('text')
    expect(block.text).toContain('openai/gpt-image-2.5-sunburst')
    expect(block.text).toContain('Diagrams and flowcharts')
  })

  it('serves the guide as a resource over the MCP protocol', async () => {
    const server = createMCPServer().initialize()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    try {
      const listed = await client.listResources()
      expect(listed.resources.map((r) => r.uri)).toContain('guide://image-models')

      const read = await client.readResource({ uri: 'guide://image-models' })
      expect(read.contents[0]).toMatchObject({
        uri: 'guide://image-models',
        mimeType: 'text/markdown',
        text: MODEL_GUIDE_MARKDOWN,
      })

      await expect(client.readResource({ uri: 'guide://nope' })).rejects.toThrow()
    } finally {
      await client.close()
      await server.close()
    }
  })
})
