/**
 * Smoke tests for the MCP server surface (provider-neutral).
 *
 * Full generate_voice/generate_music flows are covered in
 * mcpServer.generate.test.ts (with the OpenRouter client mocked). Here we
 * assert the static server metadata and tool schemas, which do not require
 * any provider.
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

  it('lists both generate_voice and generate_music tools with prompt-required schemas', () => {
    const server = createMCPServer()
    const { tools } = server.getToolsList()

    expect(tools).toHaveLength(2)
    const voiceTool = tools.find((t) => t.name === 'generate_voice')
    const musicTool = tools.find((t) => t.name === 'generate_music')

    expect(voiceTool?.inputSchema.required).toContain('prompt')
    expect(Object.keys(voiceTool?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['prompt', 'fileName', 'voice', 'format'])
    )

    expect(musicTool?.inputSchema.required).toContain('prompt')
    expect(Object.keys(musicTool?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['prompt', 'fileName', 'length', 'format'])
    )
  })

  it('advertises an open voice string and the documented length and format enums', () => {
    const server = createMCPServer()
    const { tools } = server.getToolsList()
    const voiceProps = tools.find((t) => t.name === 'generate_voice')?.inputSchema
      .properties as Record<string, { enum?: string[]; type?: string; description?: string }>
    const musicProps = tools.find((t) => t.name === 'generate_music')?.inputSchema
      .properties as Record<string, { enum?: string[] }>

    expect(voiceProps.voice?.type).toBe('string')
    expect(voiceProps.voice?.enum).toBeUndefined()
    expect(voiceProps.voice?.description).toContain('george')
    expect(voiceProps.voice?.description).toContain('alloy')
    expect(voiceProps.format?.enum).toEqual(['wav', 'mp3'])
    expect(musicProps.length?.enum).toEqual(['clip', 'long'])
    expect(musicProps.format?.enum).toEqual(['wav', 'mp3'])
  })

  it('describes both voice endpoints and ElevenLabs support in the generate_voice tool', () => {
    const server = createMCPServer()
    const voiceTool = server.getToolsList().tools.find((t) => t.name === 'generate_voice')
    const props = voiceTool?.inputSchema.properties as Record<string, { description?: string }>

    expect(voiceTool?.description).toContain('OPENROUTER_VOICE_MODEL')
    expect(voiceTool?.description).toContain('ElevenLabs')
    expect(props.format?.description).toContain('mp3')
  })

  it('returns an error for an unknown tool name', async () => {
    const server = createMCPServer()
    const result = await server.callTool('generate_video', {})
    expect(result.isError).toBe(true)
  })
})
