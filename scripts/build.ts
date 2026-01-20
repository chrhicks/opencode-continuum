#!/usr/bin/env bun
/**
 * Build script for continuum OpenCode plugin
 * 
 * 1. Runs tests (fails build if tests fail)
 * 2. Bundles src/index.ts to .opencode/plugins/continuum.ts
 *    - Inlines SQL migrations as strings via virtual module replacement
 *    - Externalizes @opencode-ai/plugin (provided by OpenCode runtime)
 */

import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const ENTRY_POINT = 'src/plugin.ts'
const OUTPUT_DIR = '.opencode/plugins'
const OUTPUT_FILE = `${OUTPUT_DIR}/continuum.ts`
const MIGRATION_SQL = 'src/migrations/001_initial.sql'

// Bun plugin to replace migration loaders with inlined SQL
function createMigrationPlugin(): import('bun').BunPlugin {
  return {
    name: 'inline-migration',
    setup(build) {
      build.onResolve({ filter: /\.\/migration$/ }, (args) => {
        return {
          path: resolve(args.resolveDir, 'migration.ts'),
          namespace: 'inline-migration',
        }
      })

      build.onLoad({ filter: /.*/, namespace: 'inline-migration' }, async () => {
        const sql = await Bun.file(MIGRATION_SQL).text()
        const contents = `
// Auto-generated: SQL migration inlined at build time
const MIGRATION_SQL = ${JSON.stringify(sql)};

export async function getMigrationSQL(): Promise<string> {
  return MIGRATION_SQL;
}
`
        return { contents, loader: 'ts' }
      })
    },
  }
}

async function runTests(): Promise<boolean> {
  console.log('Running tests...')
  const proc = Bun.spawn(['bun', 'test'], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited
  return exitCode === 0
}

async function bundle(): Promise<boolean> {
  console.log('Bundling...')
  
  // Ensure output directory exists
  await mkdir(OUTPUT_DIR, { recursive: true })
  
  const result = await Bun.build({
    entrypoints: [ENTRY_POINT],
    outdir: OUTPUT_DIR,
    naming: 'continuum.ts',
    target: 'bun',
    format: 'esm',
    plugins: [createMigrationPlugin()],
    // Don't bundle the plugin runtime - it's provided by OpenCode
    external: ['@opencode-ai/plugin', '@opencode-ai/sdk'],
  })

  if (!result.success) {
    console.error('Build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    return false
  }

  console.log(`Built: ${OUTPUT_FILE}`)
  return true
}

async function main() {
  const skipTests = process.argv.includes('--no-test')
  
  if (!skipTests) {
    const testsOk = await runTests()
    if (!testsOk) {
      console.error('\nTests failed. Build aborted.')
      process.exit(1)
    }
    console.log('Tests passed.\n')
  }

  const buildOk = await bundle()
  if (!buildOk) {
    process.exit(1)
  }

  console.log('\nBuild complete!')
}

main()
