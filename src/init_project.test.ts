import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { rm, mkdir } from 'node:fs/promises'
import { Database } from 'bun:sqlite'
import { init_project, init_status } from './index'

const TEST_DIR = `${process.cwd()}/src/__test__`

// Expected tables from the migration
const EXPECTED_TABLES = [
  'tasks',
  'task_relationships', 
  'context_entries',
  'progress_items',
  'session_links',
  'file_associations',
  'events',
  'active_work'
]

describe('init_project', () => {
  const freshDir = `${TEST_DIR}/wrk_fresh_init`
  const partialDir = `${TEST_DIR}/wrk_partial_init`
  const idempotentDir = `${TEST_DIR}/wrk_idempotent_init`

  // Clean up test directories before and after each test
  beforeEach(async () => {
    await rm(freshDir, { recursive: true, force: true })
    await rm(partialDir, { recursive: true, force: true })
    await rm(idempotentDir, { recursive: true, force: true })
    
    // Create empty test directories
    await mkdir(freshDir, { recursive: true })
    await mkdir(partialDir, { recursive: true })
    await mkdir(idempotentDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(freshDir, { recursive: true, force: true })
    await rm(partialDir, { recursive: true, force: true })
    await rm(idempotentDir, { recursive: true, force: true })
  })

  test('creates .arbeit directory and migrated database from scratch', async () => {
    // Verify nothing exists initially
    const beforeStatus = await init_status({ directory: freshDir })
    expect(beforeStatus.pluginDirExists).toBe(false)
    expect(beforeStatus.dbFileExists).toBe(false)

    // Run init
    await init_project({ directory: freshDir })

    // Verify directory and db were created
    const afterStatus = await init_status({ directory: freshDir })
    expect(afterStatus.pluginDirExists).toBe(true)
    expect(afterStatus.dbFileExists).toBe(true)

    // Verify schema has all expected tables
    const db = new Database(`${freshDir}/.arbeit/arbeit.db`)
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    const tableNames = tables.map(t => t.name)
    
    for (const expected of EXPECTED_TABLES) {
      expect(tableNames).toContain(expected)
    }
    db.close()
  })

  test('creates only database when .arbeit directory already exists', async () => {
    // Create .arbeit directory manually (simulating partial init)
    await mkdir(`${partialDir}/.arbeit`, { recursive: true })

    const beforeStatus = await init_status({ directory: partialDir })
    expect(beforeStatus.pluginDirExists).toBe(true)
    expect(beforeStatus.dbFileExists).toBe(false)

    // Run init
    await init_project({ directory: partialDir })

    // Verify db was created
    const afterStatus = await init_status({ directory: partialDir })
    expect(afterStatus.pluginDirExists).toBe(true)
    expect(afterStatus.dbFileExists).toBe(true)

    // Verify schema is correct
    const db = new Database(`${partialDir}/.arbeit/arbeit.db`)
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    expect(tables.length).toBeGreaterThan(0)
    db.close()
  })

  test('is idempotent - calling twice does not error or corrupt state', async () => {
    // First init
    await init_project({ directory: idempotentDir })
    
    const afterFirstInit = await init_status({ directory: idempotentDir })
    expect(afterFirstInit.pluginDirExists).toBe(true)
    expect(afterFirstInit.dbFileExists).toBe(true)

    // Insert a test row to verify data persists
    const db1 = new Database(`${idempotentDir}/.arbeit/arbeit.db`)
    db1.run(`INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES ('test-1', 'Test Task', 'open', datetime('now'), datetime('now'))`)
    db1.close()

    // Second init - should not throw
    await init_project({ directory: idempotentDir })

    // Verify state is still intact
    const afterSecondInit = await init_status({ directory: idempotentDir })
    expect(afterSecondInit.pluginDirExists).toBe(true)
    expect(afterSecondInit.dbFileExists).toBe(true)

    // Verify data persisted
    const db2 = new Database(`${idempotentDir}/.arbeit/arbeit.db`)
    const task = db2.query("SELECT * FROM tasks WHERE id = 'test-1'").get() as { title: string } | null
    expect(task).not.toBeNull()
    expect(task?.title).toBe('Test Task')
    db2.close()
  })
})
