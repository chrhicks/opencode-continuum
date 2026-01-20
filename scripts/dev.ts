#!/usr/bin/env bun
/**
 * Dev script for continuum OpenCode plugin
 * 
 * Watches src/ for changes and auto-rebuilds (without running tests for speed).
 * Use `bun run build` for a full test + build.
 */

import { watch } from 'node:fs'
import { resolve } from 'node:path'

const SRC_DIR = resolve(import.meta.dir, '../src')
const DEBOUNCE_MS = 150

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingChanges: string[] = []

async function build() {
  const start = performance.now()
  const proc = Bun.spawn(['bun', 'scripts/build.ts', '--no-test'], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await proc.exited
  const duration = (performance.now() - start).toFixed(0)
  
  if (exitCode === 0) {
    console.log(`\x1b[32m[${new Date().toLocaleTimeString()}] Rebuilt in ${duration}ms\x1b[0m\n`)
  } else {
    console.log(`\x1b[31m[${new Date().toLocaleTimeString()}] Build failed\x1b[0m\n`)
  }
}

console.log('Starting dev mode...')
console.log(`Watching: ${SRC_DIR}\n`)

// Initial build
await build()

// Watch for changes with debounce
const watcher = watch(SRC_DIR, { recursive: true }, (eventType, filename) => {
  // Skip test files during dev
  if (filename?.endsWith('.test.ts')) return

  if (filename && !pendingChanges.includes(filename)) {
    pendingChanges.push(filename)
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  debounceTimer = setTimeout(async () => {
    debounceTimer = null
    const changes = pendingChanges.splice(0)
    if (changes.length > 0) {
      console.log(`\x1b[90mChanged: ${changes.join(', ')}\x1b[0m`)
    }
    await build()
  }, DEBOUNCE_MS)
})

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nStopping dev mode...')
  watcher.close()
  process.exit(0)
})

// Keep process alive
await new Promise(() => {})
