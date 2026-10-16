/**
 * Tests for module-relative .env loading (package .env first, then repo-root
 * .env, never overriding variables the MCP client already set).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadEnv, resolveEnvPaths } from '../loadEnv'

describe('resolveEnvPaths', () => {
  const pkg = resolve('/repo/mcp-image-openrouter')
  const root = resolve('/repo')

  it('returns [package .env, repo-root .env] from a src/utils module URL', () => {
    const url = pathToFileURL(join(pkg, 'src', 'utils', 'loadEnv.ts')).href

    expect(resolveEnvPaths(url)).toEqual([join(pkg, '.env'), join(root, '.env')])
  })

  it('returns the same two paths from a dist/utils module URL', () => {
    const url = pathToFileURL(join(pkg, 'dist', 'utils', 'loadEnv.js')).href

    expect(resolveEnvPaths(url)).toEqual([join(pkg, '.env'), join(root, '.env')])
  })

  it('resolves the real module location to this package first (entry-point depth cannot regress)', () => {
    const realModule = new URL('../loadEnv.ts', import.meta.url).href
    const thisPackage = resolve(fileURLToPath(new URL('../../..', import.meta.url)))

    const [first, second] = resolveEnvPaths(realModule)

    expect(first).toBe(join(thisPackage, '.env'))
    expect(second).toBe(join(resolve(thisPackage, '..'), '.env'))
  })
})

describe('loadEnv', () => {
  let dir: string
  let pkgEnv: string
  let rootEnv: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'loadenv-'))
    mkdirSync(join(dir, 'pkg'))
    pkgEnv = join(dir, 'pkg', '.env')
    rootEnv = join(dir, '.env')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lets the package .env win and fills the rest from the root .env', () => {
    writeFileSync(pkgEnv, 'X=pkg\n')
    writeFileSync(rootEnv, 'X=root\nY=rootonly\n')
    const env: Record<string, string> = {}

    loadEnv([pkgEnv, rootEnv], env)

    expect(env['X']).toBe('pkg')
    expect(env['Y']).toBe('rootonly')
  })

  it('never overrides a variable the MCP client already set', () => {
    writeFileSync(pkgEnv, 'X=pkg\n')
    writeFileSync(rootEnv, 'X=root\nY=rootonly\n')
    const env: Record<string, string> = { X: 'client' }

    loadEnv([pkgEnv, rootEnv], env)

    expect(env['X']).toBe('client')
    expect(env['Y']).toBe('rootonly')
  })

  it('does not throw when the package .env is missing and still loads the root .env', () => {
    writeFileSync(rootEnv, 'Y=rootonly\n')
    const env: Record<string, string> = {}

    expect(() => loadEnv([pkgEnv, rootEnv], env)).not.toThrow()
    expect(env['Y']).toBe('rootonly')
  })

  it('does not throw when neither file exists', () => {
    const env: Record<string, string> = {}

    expect(() => loadEnv([pkgEnv, rootEnv], env)).not.toThrow()
    expect(env).toEqual({})
  })
})
