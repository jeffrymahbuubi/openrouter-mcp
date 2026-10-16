/**
 * Loads `.env` files relative to THIS module, not the process cwd.
 *
 * Order: `<package>/.env` first, then `<repo-root>/.env` (one shared key for the
 * monorepo; a package-local file still wins). Variables already set by the MCP
 * client are never overridden.
 *
 * This is a side-effect module: entry points import it as their first import
 * (`import './utils/loadEnv.js'`) because ESM hoists static imports, so a
 * function call could not run before the modules that read the environment.
 * `src/utils` and `dist/utils` sit at the same depth, so `../..` is the
 * package and `../../..` the repo root for both the TypeScript and built forms.
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, type DotenvPopulateInput } from 'dotenv'

/** `[<package>/.env, <repo-root>/.env]` for a module living in `<package>/{src,dist}/utils/`. */
export function resolveEnvPaths(moduleUrl: string): string[] {
  const moduleDir = dirname(fileURLToPath(moduleUrl))
  const packageDir = resolve(moduleDir, '..', '..')
  const repoRoot = resolve(packageDir, '..')
  return [join(packageDir, '.env'), join(repoRoot, '.env')]
}

/** Loads the given files in order without overriding existing variables; missing files are skipped. */
export function loadEnv(
  paths: string[],
  processEnv: DotenvPopulateInput = process.env as DotenvPopulateInput
): void {
  config({ path: paths, processEnv, override: false, quiet: true })
}

loadEnv(resolveEnvPaths(import.meta.url))
