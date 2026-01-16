/**
 * Migration SQL loader
 * 
 * During development/testing: loads SQL from file system
 * When bundled: the build process replaces this with an inline version
 */

// This gets replaced during bundling with the actual SQL content
// See scripts/build.ts which generates migration.bundled.ts
let cachedMigration: string | null = null

export async function getMigrationSQL(): Promise<string> {
  if (cachedMigration) return cachedMigration
  
  // Load from file system (dev/test mode)
  const migrationPath = new URL('./migrations/001_initial.sql', import.meta.url).pathname
  cachedMigration = await Bun.file(migrationPath).text()
  return cachedMigration
}
